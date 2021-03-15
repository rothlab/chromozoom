// For some reason, using the system font BlinkMacSystemFont crashes in OffscreenCanvas in Chrome on Mac OS (as of v89)
// This loads a webfont version of San Francisco to replace it in Macs, while on Windows, Segoe UI is loaded
// preferentially before it.

module.exports = function loadWorkerFonts(global) {
  if (global.FontFace) {
    // first declare our font-faces
    var systemWebFontRegular = new FontFace(
      'SystemWebFont',
      "local('Segoe UI'), url('../css/fonts/sanfranciscodisplay-medium-webfont.woff2') format('woff2')",
      {
        'weight': 400,
        'style': 'normal'
      }
    );
    var systemWebFontBold = new FontFace(
      'SystemWebFont',
      "local('Segoe UI'), url('../css/fonts/sanfranciscodisplay-bold-webfont.woff2') format('woff2')",
      {
        'weight': 700,
        'style': 'normal'
      }
    );
    // add them to the list of fonts our worker supports
    global.fonts.add(systemWebFontRegular);
    global.fonts.add(systemWebFontBold);
    // load the fonts
    systemWebFontRegular.load();
    systemWebFontBold.load();
  }
};
