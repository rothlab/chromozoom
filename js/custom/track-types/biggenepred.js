// ================================================================================
// = bigGenePred format: https://genome.ucsc.edu/goldenPath/help/bigGenePred.html =
// ================================================================================

var bigbed = require('./bigbed.js'),
  utils = require('./utils/utils.js'),
  strip = utils.strip;

// Intended to be loaded into CustomTrack.types.biggenepred
var BigGenePredFormat = _.extend({}, bigbed, {
  defaults: _.extend({}, bigbed.defaults, {
    baseColorUseCds: "given"
  }),
  
  tipTipData: function(feature) {
    var tipTipData = {};
    if (!_.isUndefined(feature.extra.geneName2)) { tipTipData.description = feature.extra.geneName2; }
    _.extend(tipTipData, {
      id: feature.name,
      position: feature.chrom + ':' + (parseInt10(feature.chromStart) + 1), // anything user-facing uses 1-based coordinates
      size: feature.chromEnd - feature.chromStart
    });
    if (!_.isUndefined(feature.score) && feature.score > 0) { tipTipData.score = feature.score; }
    return tipTipData;
  },

  nameFunc: function(d) {
    return strip(d.extra.name2 || d.extra.geneName || d.name || d.id || '');
  }
  
});

module.exports = BigGenePredFormat;