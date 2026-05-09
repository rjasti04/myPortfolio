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
      }
    }
  } catch (e) {
    console.error("Failed to load custom theme palette", e);
  }
})();
