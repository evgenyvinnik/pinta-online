#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
	exec dbus-run-session -- "$0" "$@"
fi

scenario="${1:?native capture scenario is required}"
output="${2:?native capture output path is required}"
theme="${3:-light}"

case "$theme" in
  light) color_scheme=1 ;;
  dark) color_scheme=2 ;;
  *) echo "Unsupported native capture theme: $theme" >&2; exit 1 ;;
esac

capture_profile="$(mktemp -d)"
display_number=99
export XDG_CONFIG_HOME="$capture_profile/.config"
export XDG_CACHE_HOME="$capture_profile/.cache"
export XDG_DATA_HOME="$capture_profile/.local/share"
export DOTNET_CLI_HOME="$capture_profile/.dotnet"
export DISPLAY=":$display_number"
export GTK_A11Y=atspi
export NO_AT_BRIDGE=0
mkdir -p "$XDG_CONFIG_HOME/Pinta" "$(dirname "$output")"

cat > "$XDG_CONFIG_HOME/Pinta/settings.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<settings>
  <setting name="color-scheme" type="System.Int32">$color_scheme</setting>
  <setting name="window-maximized" type="System.Boolean">False</setting>
  <setting name="window-size-width" type="System.Int32">1440</setting>
  <setting name="window-size-height" type="System.Int32">960</setting>
  <setting name="toolbar-shown" type="System.Boolean">True</setting>
  <setting name="toolbox-shown" type="System.Boolean">True</setting>
  <setting name="tool-windows-shown" type="System.Boolean">True</setting>
  <setting name="statusbar-shown" type="System.Boolean">True</setting>
  <setting name="image-tabs-shown" type="System.Boolean">True</setting>
</settings>
EOF

cleanup() {
  kill "${pinta_pid:-}" "${openbox_pid:-}" "${xvfb_pid:-}" 2>/dev/null || true
  rm -rf "$capture_profile"
}
trap cleanup EXIT

Xvfb "$DISPLAY" -screen 0 1600x1100x24 -ac >"$capture_profile/xvfb.log" 2>&1 &
xvfb_pid=$!
for _ in $(seq 1 40); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.1
done
dbus-update-activation-environment DISPLAY XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME >/dev/null
gsettings set org.gnome.desktop.interface toolkit-accessibility true
openbox >"$capture_profile/openbox.log" 2>&1 &
openbox_pid=$!

if [[ "${PINTA_NATIVE_SKIP_BUILD:-0}" != "1" ]]; then
	dotnet build original/Pinta.sln --nologo >"$capture_profile/build.log"
fi
dotnet original/build/bin/Pinta.dll >"$capture_profile/pinta.log" 2>&1 &
pinta_pid=$!

find_largest_visible_window() {
	local pattern="$1"
	local best=''
	local best_area=0
	local candidate width height area
	while read -r candidate; do
		[[ -n "$candidate" ]] || continue
		width="$(xdotool getwindowgeometry --shell "$candidate" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
		height="$(xdotool getwindowgeometry --shell "$candidate" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
		[[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
		area=$((width * height))
		if (( area > best_area )); then
			best="$candidate"
			best_area="$area"
		fi
	done < <(xdotool search --onlyvisible --name "$pattern" 2>/dev/null || true)
	if (( best_area >= 10000 )); then
		echo "$best"
	fi
}

click_window_at() {
	local target_window="$1"
	local relative_x="$2"
	local relative_y="$3"
	local window_x window_y
	window_x="$(xdotool getwindowgeometry --shell "$target_window" | awk -F= '$1 == "X" { print $2 }')"
	window_y="$(xdotool getwindowgeometry --shell "$target_window" | awk -F= '$1 == "Y" { print $2 }')"
	xdotool mousemove --sync "$((window_x + relative_x))" "$((window_y + relative_y))"
	xdotool mousedown 1
	sleep 0.1
	xdotool mouseup 1
}

capture_main_window_with_popover() {
	local main_window="$1"
	local destination="$2"
	local window_x window_y width height root_capture
	window_x="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "X" { print $2 }')"
	window_y="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "Y" { print $2 }')"
	width="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "WIDTH" { print $2 }')"
	height="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "HEIGHT" { print $2 }')"
	root_capture="$capture_profile/root-with-popover.png"
	sleep 0.45
	magick import -display "$DISPLAY" -window root "$root_capture"
	magick "$root_capture" -crop "${width}x${height}+${window_x}+${window_y}" +repage "$destination"
}

capture_main_window_with_right_overflow() {
	local main_window="$1"
	local destination="$2"
	local window_x window_y height capture_width root_capture
	window_x="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "X" { print $2 }')"
	window_y="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "Y" { print $2 }')"
	height="$(xdotool getwindowgeometry --shell "$main_window" | awk -F= '$1 == "HEIGHT" { print $2 }')"
	capture_width=$((1600 - window_x))
	root_capture="$capture_profile/root-with-right-overflow.png"
	sleep 0.45
	magick import -display "$DISPLAY" -window root "$root_capture"
	magick "$root_capture" -crop "${capture_width}x${height}+${window_x}+${window_y}" +repage "$destination"
}

dismiss_popovers() {
	xdotool key Escape
	xdotool key Escape
	sleep 0.25
}

capture_titled_window() {
	local title="$1"
	local destination="$2"
	local dialog_window=''
	local color_count=0
	for _ in $(seq 1 100); do
		dialog_window="$(find_largest_visible_window "$title")"
		[[ -n "$dialog_window" ]] && break
		sleep 0.15
	done
	if [[ -z "$dialog_window" ]]; then
		xwininfo -root -tree >&2
		echo "Native window did not appear: $title" >&2
		return 1
	fi
	for _ in $(seq 1 20); do
		magick import -display "$DISPLAY" -window "$dialog_window" "$destination"
		color_count="$(magick identify -format '%k' "$destination")"
		(( color_count > 16 )) && break
		sleep 0.2
	done
	if (( color_count <= 16 )); then
		echo "Native window capture stayed blank: $title" >&2
		return 1
	fi
	printf '%s' "$dialog_window"
}

capture_accessible_area() {
	local name="$1"
	local role="$2"
	local destination="$3"
	local match_mode="${4:-exact}"
	local bounds x y width height root_capture
	local match_args=()
	[[ "$match_mode" == 'contains' ]] && match_args+=(--contains)
	bounds="$(python tests/visual/native/native-ui.py bounds "$name" --role "$role" --timeout 15 "${match_args[@]}")"
	read -r x y width height <<<"$bounds"
	if [[ ! "$x" =~ ^-?[0-9]+$ || ! "$y" =~ ^-?[0-9]+$ || ! "$width" =~ ^[0-9]+$ || ! "$height" =~ ^[0-9]+$ ]]; then
		echo "Invalid accessible bounds for $role $name: $bounds" >&2
		return 1
	fi
	root_capture="$capture_profile/root-accessible.png"
	sleep 0.45
	magick import -display "$DISPLAY" -window root "$root_capture"
	magick "$root_capture" -crop "${width}x${height}+${x}+${y}" +repage "$destination"
}

capture_centered_accessible_area() {
	local name="$1"
	local role="$2"
	local destination="$3"
	local match_mode="${4:-exact}"
	local match_args=()
	local bounds ignored_x ignored_y width height
	local main_x main_y main_width main_height crop_x crop_y root_capture
	[[ "$match_mode" == 'contains' ]] && match_args+=(--contains)
	bounds="$(python tests/visual/native/native-ui.py bounds "$name" --role "$role" --timeout 15 "${match_args[@]}")"
	read -r ignored_x ignored_y width height <<<"$bounds"
	main_x="$(xdotool getwindowgeometry --shell "$window" | awk -F= '$1 == "X" { print $2 }')"
	main_y="$(xdotool getwindowgeometry --shell "$window" | awk -F= '$1 == "Y" { print $2 }')"
	main_width="$(xdotool getwindowgeometry --shell "$window" | awk -F= '$1 == "WIDTH" { print $2 }')"
	main_height="$(xdotool getwindowgeometry --shell "$window" | awk -F= '$1 == "HEIGHT" { print $2 }')"
	crop_x=$((main_x + (main_width - width) / 2))
	crop_y=$((main_y + (main_height - height) / 2))
	root_capture="$capture_profile/root-centered-accessible.png"
	sleep 0.45
	magick import -display "$DISPLAY" -window root "$root_capture"
	magick "$root_capture" -crop "${width}x${height}+${crop_x}+${crop_y}" +repage "$destination"
}

capture_main_window() {
	local main_window="$1"
	local destination="$2"
	local color_count=0
	for _ in $(seq 1 20); do
		magick import -display "$DISPLAY" -window "$main_window" "$destination"
		color_count="$(magick identify -format '%k' "$destination")"
		(( color_count > 16 )) && return 0
		sleep 0.2
	done
	echo "Native main-window capture stayed blank: $destination" >&2
	return 1
}

click_accessible_center() {
	local name="$1"
	local role="$2"
	local bounds x y width height
	bounds="$(python tests/visual/native/native-ui.py bounds "$name" --role "$role" --timeout 15)"
	read -r x y width height <<<"$bounds"
	xdotool mousemove --sync "$((x + width / 2))" "$((y + height / 2))"
	xdotool click 1
	sleep 0.25
}

dismiss_dialog() {
	local title="$1"
	xdotool key Escape
	for _ in $(seq 1 30); do
		[[ -z "$(find_largest_visible_window "$title")" ]] && return 0
		sleep 0.1
	done
	python tests/visual/native/native-ui.py click 'Cancel' --role button --timeout 1 >/dev/null 2>&1 || true
	python tests/visual/native/native-ui.py click 'Close' --role button --timeout 1 >/dev/null 2>&1 || true
	sleep 0.3
}

window=''
for _ in $(seq 1 100); do
  window="$(find_largest_visible_window 'Pinta')"
  [[ -n "$window" ]] && break
  sleep 0.15
done
if [[ -z "$window" ]]; then
  cat "$capture_profile/pinta.log" >&2
  echo 'Native Pinta window did not appear.' >&2
  exit 1
fi

# Openbox can expose the mapped window just before it publishes
# _NET_ACTIVE_WINDOW. The app is already visible, so activation is best-effort.
xdotool windowactivate --sync "$window" 2>/dev/null || true
sleep 1

case "$scenario" in
  workspace-default)
	# Pinta creates the initial 800 x 600 document during startup.
	sleep 2
    ;;
  workspace-states-all)
	main_window="$window"
	mkdir -p "$output"
	sleep 3

	xdotool windowfocus --sync "$main_window"
	xdotool key ctrl+a
	sleep 0.35
	capture_main_window "$main_window" "$output/workspace-selection.png"

	xdotool key ctrl+shift+a
	click_window_at "$main_window" 32 781
	click_window_at "$main_window" 450 300
	xdotool type --delay 35 'Pinta Online'
	sleep 0.5
	capture_main_window "$main_window" "$output/workspace-text-editor.png"
	xdotool key Escape

	xdotool windowsize "$main_window" 800 720
	sleep 0.75
	capture_main_window "$main_window" "$output/workspace-responsive-800x720.png"
	xdotool windowsize "$main_window" 1440 960
	sleep 0.75

	# Native Pinta accepts file drops without rendering a persistent overlay.
	# Capture that native resting state as the explicit comparison evidence.
	capture_main_window "$main_window" "$output/workspace-file-drop.png"

	# This native header-bar build has no Toolbar entry in Show/Hide, so its
	# fixed-header resting state is the comparison evidence for the web toggle.
	capture_main_window "$main_window" "$output/workspace-toolbar-hidden.png"

	python tests/visual/native/native-ui.py click 'View' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '5,0' >/dev/null
	python tests/visual/native/native-ui.py click 'View' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '3' >/dev/null
	click_accessible_center 'Show Grid' 'check box'
	python tests/visual/native/native-ui.py click 'OK' --role button >/dev/null
	sleep 0.5
	capture_main_window "$main_window" "$output/workspace-rulers-and-grid.png"

	for item_index in 2 3 4 5; do
		python tests/visual/native/native-ui.py click 'View' --role 'toggle button' >/dev/null
		python tests/visual/native/native-ui.py menu "5,$item_index" >/dev/null
	done
	sleep 0.5
	capture_main_window "$main_window" "$output/workspace-distraction-free.png"

	identify "$output"/workspace-*.png
	exit 0
	;;
  dialog-new-image)
	# Click Pinta's New toolbar button. This avoids GTK accelerator delivery
	# differences under x86 emulation and keeps the capture deterministic.
	sleep 4
	main_window="$window"
	window=''
	for attempt in $(seq 1 5); do
		click_window_at "$main_window" 28 28
		for _ in $(seq 1 20); do
			window="$(find_largest_visible_window 'New Image')"
			[[ -n "$window" ]] && break 2
			sleep 0.2
		done
	done
	if [[ -z "$window" ]]; then
		xdotool windowactivate --sync "$main_window"
		xdotool key --window "$main_window" ctrl+n
		for _ in $(seq 1 50); do
			window="$(find_largest_visible_window 'New Image')"
			[[ -n "$window" ]] && break
			sleep 0.2
		done
	fi
    if [[ -z "$window" ]]; then
		xwininfo -root -tree >&2
		echo 'New Image dialog did not appear.' >&2
		exit 1
	fi
    ;;
  menus-all)
	main_window="$window"
	mkdir -p "$output"
	sleep 3
	header_menu_specs=(
		'View|menu-view|menubar-view'
		'Image|menu-image|menubar-image'
		'Adjustments|menu-adjustments|menubar-adjustments'
		'Effects|menu-effects-top|menu-effects-bottom|menubar-effects-top|menubar-effects-bottom'
		'Main Menu|menu-main-top|menu-main-bottom|menubar-pinta'
	)
	for spec in "${header_menu_specs[@]}"; do
		IFS='|' read -ra parts <<<"$spec"
		python tests/visual/native/native-ui.py click "${parts[0]}" --role 'toggle button' >/dev/null
		for (( part_index=1; part_index<${#parts[@]}; part_index++ )); do
			capture_main_window_with_popover "$main_window" "$output/${parts[$part_index]}.png"
		done
		dismiss_popovers
	done

	main_submenu_specs=(
		'0|menubar-file'
		'1|menubar-edit'
		'2|menubar-add-ins'
		'3|menubar-window'
		'4|menubar-help'
	)
	for spec in "${main_submenu_specs[@]}"; do
		IFS='|' read -r submenu_index file_stem <<<"$spec"
		python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
		python tests/visual/native/native-ui.py menu "$submenu_index" >/dev/null
		capture_main_window_with_popover "$main_window" "$output/$file_stem.png"
		dismiss_popovers
	done

	# The Layers dock menu is an icon-only GTK button, so use its stable
	# bottom-right dock position in the fixed 1440 x 960 reference window.
	click_window_at "$main_window" 1412 477
	capture_main_window_with_right_overflow "$main_window" "$output/menu-layer.png"
	dismiss_popovers
	identify "$output"/{menu,menubar}-*.png
	exit 0
	;;
  standalone-dialogs-all)
	main_window="$window"
	mkdir -p "$output"
	sleep 3

	open_capture_dismiss() {
		local key="$1"
		local title="$2"
		local file_stem="$3"
		xdotool windowfocus --sync "$main_window"
		xdotool key "$key"
		capture_titled_window "$title" "$output/$file_stem.png" >/dev/null
		dismiss_dialog "$title"
	}

	open_capture_dismiss ctrl+r 'Resize Image' 'dialog-resize-image'
	open_capture_dismiss ctrl+shift+r 'Resize Canvas' 'dialog-resize-canvas'

	python tests/visual/native/native-ui.py click 'View' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '3' >/dev/null
	capture_titled_window 'Canvas Grid Settings' "$output/dialog-canvas-grid.png" >/dev/null
	dismiss_dialog 'Canvas Grid Settings'

	open_capture_dismiss F4 'Layer Properties' 'dialog-layer-properties'

	click_window_at "$main_window" 1412 477
	python tests/visual/native/native-ui.py menu '3' >/dev/null
	capture_titled_window 'Rotate / Zoom Layer' "$output/dialog-rotate-zoom-layer.png" >/dev/null
	dismiss_dialog 'Rotate / Zoom Layer'

	xdotool windowfocus --sync "$main_window"
	xdotool key ctrl+a
	open_capture_dismiss ctrl+shift+o 'Offset Selection' 'dialog-offset-selection'

	python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '1,14,3' >/dev/null
	capture_titled_window 'Resize Palette' "$output/dialog-resize-palette.png" >/dev/null
	dismiss_dialog 'Resize Palette'

	python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '1,14,1' >/dev/null
	capture_titled_window 'Save Palette File' "$output/dialog-save-palette.png" >/dev/null
	dismiss_dialog 'Save Palette File'

	python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '0,4' >/dev/null
	capture_titled_window 'Save Image File' "$output/dialog-save-image-as.png" >/dev/null
	dismiss_dialog 'Save Image File'

	xdotool keydown ctrl
	click_window_at "$main_window" 174 929
	xdotool keyup ctrl
	capture_titled_window 'Choose Palette Color' "$output/dialog-edit-palette-color.png" >/dev/null
	dismiss_dialog 'Choose Palette Color'

	python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '4,1' >/dev/null
	python tests/visual/native/native-ui.py wait 'Keyboard Shortcuts' --role dialog --timeout 15 >/dev/null
	capture_accessible_area 'Keyboard Shortcuts' dialog "$output/dialog-keyboard-shortcuts.png"
	xdotool key End
	xdotool key Page_Down
	sleep 0.4
	capture_accessible_area 'Keyboard Shortcuts' dialog "$output/dialog-keyboard-shortcuts-bottom.png"
	dismiss_dialog 'Keyboard Shortcuts'

	python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '4,5' >/dev/null
	capture_titled_window 'About Pinta' "$output/dialog-about.png" >/dev/null
	dismiss_dialog 'About Pinta'

	# A fresh native document is clean. Paint one pixel so both close actions
	# expose their real libadwaita save confirmation instead of closing at once.
	click_window_at "$main_window" 500 300
	sleep 0.5
	xdotool windowfocus --sync "$main_window"
	xdotool key ctrl+w
	python tests/visual/native/native-ui.py wait 'Save changes to image' --role dialog --contains --timeout 15 >/dev/null
	capture_centered_accessible_area 'Save changes to image' dialog "$output/dialog-close-document.png" contains
	python tests/visual/native/native-ui.py click 'Cancel' --role button >/dev/null
	sleep 0.35
	xdotool windowfocus --sync "$main_window"
	xdotool key ctrl+shift+w
	python tests/visual/native/native-ui.py wait 'Save changes to image' --role dialog --contains --timeout 15 >/dev/null
	capture_centered_accessible_area 'Save changes to image' dialog "$output/dialog-close-all.png" contains
	python tests/visual/native/native-ui.py click 'Cancel' --role button >/dev/null
	sleep 0.35

	# New Screenshot is delegated to an OS-owned portal and Printing is disabled
	# in this native revision. Preserve the native File menu as the provenance
	# reference for both web-owned dialogs rather than fabricating native UI.
	python tests/visual/native/native-ui.py click 'Main Menu' --role 'toggle button' >/dev/null
	python tests/visual/native/native-ui.py menu '0' >/dev/null
	capture_main_window_with_popover "$main_window" "$output/dialog-new-screenshot.png"
	capture_main_window_with_popover "$main_window" "$output/dialog-print-image.png"
	dismiss_popovers

	identify "$output"/dialog-*.png
	exit 0
	;;
  adjustment-dialogs-all)
	adjustment_specs=(
		'2|adjustment-brightness-contrast|Brightness / Contrast'
		'3|adjustment-curves|Curves'
		'4|adjustment-hue-saturation|Hue / Saturation'
		'6|adjustment-levels|Levels'
		'7|adjustment-posterize|Posterize'
	)
	mkdir -p "$output"
	sleep 3
	for spec in "${adjustment_specs[@]}"; do
		IFS='|' read -r adjustment_index file_stem dialog_title <<<"$spec"
		python tests/visual/native/native-ui.py click 'Adjustments' --role 'toggle button' >/dev/null
		python tests/visual/native/native-ui.py menu "$adjustment_index" >/dev/null
		python tests/visual/native/native-ui.py wait "$dialog_title" --role dialog --timeout 15 >/dev/null
		dialog_window=''
		for _ in $(seq 1 60); do
			dialog_window="$(find_largest_visible_window "$dialog_title")"
			[[ -n "$dialog_window" ]] && break
			sleep 0.15
		done
		if [[ -z "$dialog_window" ]]; then
			echo "Adjustment dialog window did not appear: $dialog_title" >&2
			exit 1
		fi
		adjustment_output="$output/$file_stem.png"
		for _ in $(seq 1 20); do
			magick import -display "$DISPLAY" -window "$dialog_window" "$adjustment_output"
			color_count="$(magick identify -format '%k' "$adjustment_output")"
			(( color_count > 16 )) && break
			sleep 0.2
		done
		if (( color_count <= 16 )); then
			echo "Adjustment dialog capture stayed blank: $dialog_title" >&2
			exit 1
		fi
		python tests/visual/native/native-ui.py click 'Cancel' --role button >/dev/null
		sleep 0.25
	done
	identify "$output"/adjustment-*.png
	exit 0
	;;
  effect-dialogs-all)
	effect_specs=(
		'0|0|artistic-ink-sketch|Ink Sketch'
		'0|1|artistic-oil-painting|Oil Painting'
		'0|2|artistic-pencil-sketch|Pencil Sketch'
		'1|0|blur-fragment|Fragment'
		'1|1|blur-gaussian-blur|Gaussian Blur'
		'1|2|blur-motion-blur|Motion Blur'
		'1|3|blur-radial-blur|Radial Blur'
		'1|4|blur-unfocus|Unfocus'
		'1|5|blur-zoom-blur|Zoom Blur'
		'2|0|color-dithering|Dithering'
		'3|0|distort-bulge|Bulge'
		'3|1|distort-dents|Dents'
		'3|2|distort-frosted-glass|Frosted Glass'
		'3|3|distort-pixelate|Pixelate'
		'3|4|distort-polar-inversion|Polar Inversion'
		'3|5|distort-tile-reflection|Tile Reflection'
		'3|6|distort-twist|Twist'
		'4|0|noise-add-noise|Add Noise'
		'4|1|noise-median|Median'
		'4|2|noise-reduce-noise|Reduce Noise'
		'5|0|object-align-object|Align Object'
		'5|1|object-feather-object|Feather Object'
		'5|2|object-outline-object|Outline Object'
		'6|0|photo-glow|Glow'
		'6|1|photo-red-eye-removal|Red Eye Removal'
		'6|2|photo-sharpen|Sharpen'
		'6|3|photo-soften-portrait|Soften Portrait'
		'6|4|photo-vignette|Vignette'
		'7|0|render-cells|Cells'
		'7|1|render-clouds|Clouds'
		'7|2|render-julia-fractal|Julia Fractal'
		'7|3|render-mandelbrot-fractal|Mandelbrot Fractal'
		'7|4|render-voronoi-diagram|Voronoi Diagram'
		'8|0|stylize-edge-detect|Edge Detect'
		'8|1|stylize-emboss|Emboss'
		'8|2|stylize-outline-edge|Outline Edge'
		'8|3|stylize-relief|Relief'
	)
	mkdir -p "$output"
	sleep 3
	for spec in "${effect_specs[@]}"; do
		IFS='|' read -r category_index effect_index file_stem dialog_title <<<"$spec"
		python tests/visual/native/native-ui.py click 'Effects' --role 'toggle button' >/dev/null
		python tests/visual/native/native-ui.py menu "$category_index,$effect_index" >/dev/null
		python tests/visual/native/native-ui.py wait "$dialog_title" --role dialog --timeout 15 >/dev/null
		dialog_window=''
		for _ in $(seq 1 60); do
			dialog_window="$(find_largest_visible_window "$dialog_title")"
			[[ -n "$dialog_window" ]] && break
			sleep 0.15
		done
		if [[ -z "$dialog_window" ]]; then
			echo "Effect dialog window did not appear: $dialog_title" >&2
			exit 1
		fi
		effect_output="$output/$file_stem.png"
		for _ in $(seq 1 20); do
			magick import -display "$DISPLAY" -window "$dialog_window" "$effect_output"
			color_count="$(magick identify -format '%k' "$effect_output")"
			(( color_count > 16 )) && break
			sleep 0.2
		done
		if (( color_count <= 16 )); then
			echo "Effect dialog capture stayed blank: $dialog_title" >&2
			exit 1
		fi
		python tests/visual/native/native-ui.py click 'Cancel' --role button >/dev/null
		for _ in $(seq 1 40); do
			find_largest_visible_window "$dialog_title" >/dev/null || break
			sleep 0.1
		done
	done
	identify "$output"/{artistic,blur,color,distort,noise,object,photo,render,stylize}-*.png
	exit 0
	;;
  tool-options-all)
	tool_ids=(
		move-pixels move-selection zoom pan rectangle-select ellipse-select
		lasso-select magic-wand paintbrush pencil eraser paint-bucket gradient
		color-picker text line rectangle rounded-rectangle ellipse freeform
		clone-stamp recolor
	)
	mkdir -p "$output"
	full_capture="$capture_profile/tool-window.png"
	sleep 2
	for index in "${!tool_ids[@]}"; do
		if (( index < 17 )); then
			tool_x=32
			tool_y=$((123 + index * 47))
		else
			tool_x=87
			tool_y=$((123 + (index - 17) * 47))
		fi
		click_window_at "$window" "$tool_x" "$tool_y"
		sleep 0.3
		tool_capture="$output/tool-${tool_ids[$index]}.png"
		for _ in $(seq 1 20); do
			magick import -display "$DISPLAY" -window "$window" "$full_capture"
			magick "$full_capture" -crop 1440x48+0+50 +repage "$tool_capture"
			color_count="$(magick identify -format '%k' "$tool_capture")"
			(( color_count > 16 )) && break
			sleep 0.25
		done
		if (( color_count <= 16 )); then
			echo "Tool toolbar capture stayed blank: ${tool_ids[$index]}" >&2
			exit 1
		fi
	done
	identify "$output"/tool-*.png
	exit 0
	;;
  *)
    echo "Unsupported native capture scenario: $scenario" >&2
    exit 1
    ;;
esac

capture_tmp="$capture_profile/capture.png"
for _ in $(seq 1 20); do
	magick import -display "$DISPLAY" -window "$window" "$capture_tmp"
	color_count="$(magick identify -format '%k' "$capture_tmp")"
	if (( color_count > 16 )); then
		mv "$capture_tmp" "$output"
		identify "$output"
		exit 0
	fi
	xdotool windowactivate --sync "$window" 2>/dev/null || true
	sleep 0.25
done

cat "$capture_profile/pinta.log" >&2
echo "Native capture stayed blank after repaint retries (scenario: $scenario, window: $window)." >&2
exit 1
