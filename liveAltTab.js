const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Settings = Extension.imports.settings;
const Utils = Extension.imports.utils;
const Keybindings = Extension.imports.keybindings;
const Tiling = Extension.imports.tiling;
const Scratch = Extension.imports.scratch;
const Easer = Extension.imports.utils.easer;

const { Clutter, Meta, Gio, GObject } = imports.gi;
const Main = imports.ui.main;
const AltTab = imports.ui.altTab;

var LiveAltTab = GObject.registerClass(
    class LiveAltTab extends AltTab.WindowSwitcherPopup {
        _init(reverse) {
            this.reverse = reverse;
            super._init();
        }

        _getWindowList(reverse) {
            let tabList = global.display.get_tab_list(
                Meta.TabList.NORMAL_ALL,
                switcherSettings.get_boolean('current-workspace-only')
                    ? global.workspace_manager.get_active_workspace() : null)
                .filter(w => !Scratch.isScratchWindow(w));

            let scratch = Scratch.getScratchWindows();

            if (Scratch.isScratchWindow(global.display.focus_window)) {
                // Access scratch windows in mru order with shift-super-tab
                return scratch.concat(this.reverse ? tabList.reverse() : tabList);
            } else {
                return tabList.concat(this.reverse ? scratch.reverse() : scratch);
            }
        }

        _initialSelection(backward, actionName) {
            this.space = Tiling.spaces.selectedSpace;
            this.space.startAnimate();

            let monitor = Tiling.spaces.selectedSpace.monitor;
            let workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            let fog = new Clutter.Actor({
                x: workArea.x, y: workArea.y,
                width: workArea.width, height: workArea.height,
                opacity: 0, background_color: Clutter.color_from_string("black")[1],
            });

            // this.blur = new Clutter.BlurEffect();
            // this.space.cloneContainer.add_effect(this.blur);
            this.space.setSelectionInactive();

            Main.uiGroup.insert_child_above(fog, global.window_group);
            Easer.addEase(fog, {
                time: Settings.prefs.animation_time,
                opacity: 100,
            });
            this.fog = fog;

            super._initialSelection(backward, actionName);
        }

        _keyPressHandler(keysym, mutterActionId) {
            if (keysym === Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            // After the first super-tab the mutterActionId we get is apparently
            // SWITCH_APPLICATIONS so we need to case on those too.
            switch (mutterActionId) {
            case Meta.KeyBindingAction.SWITCH_APPLICATIONS:
                mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS;
                break;
            case Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD:
                mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
                break;
            case Keybindings.idOf('live-alt-tab'):
                mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS;
                break;
            case Keybindings.idOf('live-alt-tab-backward'):
                mutterActionId = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
                break;
            }
            // let action = Keybindings.byId(mutterActionId);
            // if (action && action.options.activeInNavigator) {
            //     let space = Tiling.spaces.selectedSpace;
            //     let metaWindow = space.selectedWindow;
            //     action.handler(metaWindow, space);
            //     return true;
            // }
            return super._keyPressHandler(keysym, mutterActionId);
        }

        _select(num) {
            let to = this._switcherList.windows[num];

            this.clone && this.clone.destroy();
            this.clone = null;

            let actor = to.get_compositor_private();
            actor.remove_clip();
            let frame = to.get_frame_rect();
            let clone = new Clutter.Clone({ source: actor });
            clone.position = actor.position;

            let space = Tiling.spaces.spaceOfWindow(to);
            if (space.indexOf(to) !== -1) {
                clone.x = Tiling.ensuredX(to, space) + space.monitor.x;
                clone.x -= frame.x - actor.x;
            }

            this.clone = clone;
            Main.uiGroup.insert_child_above(clone, this.fog);

            // Tiling.ensureViewport(to, space);
            this._selectedIndex = num;
            this._switcherList.highlight(num);
        }

        _finish() {
            this.was_accepted = true;
            super._finish();
        }

        _itemEnteredHandler() {
            // The item-enter (mouse hover) event is triggered even after a item is
            // accepted. This can cause _select to run on the item below the pointer
            // ensuring the wrong window.
            if (!this.was_accepted) {
                super._itemEnteredHandler.apply(this, arguments);
            }
        }

        _onDestroy() {
            super._onDestroy();
            Utils.debug('#preview', 'onDestroy', this.was_accepted);
            Easer.addEase(this.fog, {
                time: Settings.prefs.animation_time,
                opacity: 0,
                onStopped: () => {
                    this.fog.destroy();
                    this.fog = null;
                    // this.space.cloneContainer.remove_effect(this.blur);
                    this.clone && this.clone.destroy();
                    this.clone = null;
                    this.space.moveDone();
                },
            });
            let index = this.was_accepted ? this._selectedIndex : 0;
            let to = this._switcherList.windows[index];
            Tiling.focus_handler(to);
            let actor = to.get_compositor_private();
            if (this.was_accepted) {
                actor.x = this.clone.x;
                actor.y = this.clone.y;
            }
            actor.set_scale(1, 1);
        }
    });

function liveAltTab(meta_window, space, { display, screen, binding }) {
    let tabPopup = new LiveAltTab(binding.is_reversed());
    tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask());
}

let switcherSettings;
function enable() {
    switcherSettings = new Gio.Settings({
        schema_id: 'org.gnome.shell.window-switcher',
    });
}

function disable() {
    switcherSettings = null;
}
