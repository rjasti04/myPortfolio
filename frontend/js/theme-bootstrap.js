(function () {
  try {
    var savedPalette = localStorage.getItem("rj_theme_palette");
    if (savedPalette) {
      var palette = JSON.parse(savedPalette);
      var isDark = document.body.classList.contains("dark-theme");
      var modeColors = isDark ? palette.dark : palette.light;
      if (modeColors) {
        for (var key in modeColors) {
          if (Object.prototype.hasOwnProperty.call(modeColors, key)) {
            document.body.style.setProperty(key, modeColors[key]);
          }
        }

        // The custom properties are only half of the repaint: the mobile
        // browser toolbar - and the top bar of the installed PWA - is painted
        // from the theme-color meta tag, which carries the shipped amber until
        // something writes to it. Without this, a visitor with a saved palette
        // launches on the wrong bar colour until `applyTheme()` runs at
        // DOMContentLoaded, which is most visible in the standalone app,
        // straight after the splash.
        //
        // Taken from the palette rather than from a computed style: this runs
        // before first paint, deliberately, so there may be no resolved value
        // to read yet. `syncThemeColorMeta()` in theme-customizer.js takes over
        // from here and does read the live one.
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta && modeColors["--accent-fill"]) {
          meta.setAttribute("content", modeColors["--accent-fill"]);
        }
      }
    }
  } catch (e) {
    console.error("Failed to load custom theme palette", e);
  }
})();
