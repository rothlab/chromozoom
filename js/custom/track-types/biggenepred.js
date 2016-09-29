// =====================================================================
// = bigBed format: http://genome.ucsc.edu/goldenPath/help/bigBed.html =
// =====================================================================

var bigbed = require('./bigbed.js')
  utils = require('./utils/utils.js'),
  strip = utils.strip;

// Intended to be loaded into CustomTrack.types.biggenepred
var BigGenePredFormat = _.extend({}, bigbed, {
  
  tipTipData: function(itvl) {
    var tipTipData = {};
    if (!_.isUndefined(itvl.d.extra.geneName2)) { tipTipData.description = itvl.d.extra.geneName2; }
    _.extend(tipTipData, {
      id: itvl.d.name,
      position: itvl.d.chrom + ':' + itvl.d.chromStart, 
      size: itvl.d.chromEnd - itvl.d.chromStart
    });
    if (!_.isUndefined(itvl.d.score) && itvl.d.score > 0) { tipTipData.score = itvl.d.score; }
    return tipTipData;
  },

  nameFunc: function(d) {
    return strip(d.extra.name2 || d.extra.geneName || d.name || d.id || '');
  }
  
});

module.exports = BigGenePredFormat;