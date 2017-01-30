/***************************************************/
//                                                 //
// Welcome to ChromoZoom!                          //
//                                                 //
// This is the JavaScript entry point which is     //
// built into the final application by browserify  //
//                                                 //
// For information on installing, see ../README.md //
// (c) 2016 Theodore Pak, AGPL, see ../LICENSE     //
//                                                 //
/***************************************************/

require('./jquery.min.js')(window);
var jQuery = window['$'] = window.jQuery;

require('./ui/jquery-ui.min.js')(jQuery);
require('./ui/jquery-ui.touch-punch.js')(jQuery);
require('./ui/jquery.retina-canvas.js')(window, jQuery);

window._ = require('./underscore.min.js');

require('./custom/CustomTracks.js')(window);
require('./custom/CustomGenomes.js')(window);

require('./ui/jquery-ui.genobrowser.js')(jQuery);