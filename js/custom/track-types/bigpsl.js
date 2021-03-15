// ======================================================================
// = bigPsl format: https://genome.ucsc.edu/goldenPath/help/bigPsl.html =
// ======================================================================

var bigbed = require('./bigbed.js'),
  utils = require('./utils/utils.js'),
  strip = utils.strip;

var PSL_SINGLE_LINE_INTRON = 0;
var PSL_DOUBLE_LINE_INTRON = 1;

// Intended to be loaded into CustomTrack.types.biggenepred
var BigPslFormat = _.extend({}, bigbed, {
  
  defaults: _.extend({}, bigbed.defaults, {
    bedPlusFields: ['oChromStart', 'oChromEnd', 'oStrand', 'oChromSize', 'oChromStarts', 'oSequence', 'oCDS',
        'chromSize', 'match', 'misMatch', 'repMatch', 'nCount']
  }),

  init: function() {
    this.opts.xeno = this.opts.xeno || this.typeArgs[0] === 'xeno';
    this.type('bigbed').initOpts();
  },

  // PSL tracks display two parallel lines over double-sided alignment gaps
  // We implement this by extending each BED feature with an array of intronStyles
  // See http://genome.ucsc.edu/goldenPath/help/hgTracksHelp.html#PSLDisplay
  parseLine: function(line, lineno) {
    var self = this,
      itvl = self.type('bed').parseLine(line, lineno),
      // Tracks of type "bigPsl xeno" need to have their oChromStarts/blocks compared in reverse when
      //   on the negative strand of the target sequence
      reverseMode = itvl.strand === '-' && self.opts.xeno;
      
    itvl.intronStyles = [];
    if (itvl.blocks && itvl.blocks.length > 1 && itvl.extra['oChromStarts']) {
      var oChromStarts = _.map(itvl.extra['oChromStarts'].replace(/,+$/, '').split(','), parseInt10),
        blocks = reverseMode ? itvl.blocks.slice(1).reverse() : itvl.blocks.slice(0, -1);
      if (oChromStarts.length !== itvl.blocks.length) {
        self.warn("Incorrect number of oChromStarts to calculate intron styles for " + itvl.name);
        return itvl; 
      }
      var a = '', b = '';
      _.each(blocks, function(block, i) {
        var doubleSidedGap = oChromStarts[i + 1] - oChromStarts[i] > block.end - block.start,
          intronNum = reverseMode ? blocks.length - i - 1 : i;
        itvl.intronStyles[intronNum] = doubleSidedGap ? PSL_DOUBLE_LINE_INTRON : PSL_SINGLE_LINE_INTRON;
      });
    }
    return itvl;
  },
  
  predrawIntrons: function(ctx, lineY, halfHeight, startX, width) {
    // Normally this function draws the entire feature as a 1px line but PSL has multiple intron styles.
    // So, this is wasted effort. Therefore, do nothing.
  },

  drawIntron: function(ctx, canvasWidth, lineY, halfHeight, startX, endX, color, data, intronNum) {
    if (data.d.strand && endX - startX > 0 && endX >= 0 && startX <= canvasWidth) {
      ctx.strokeStyle = "rgb(" + color + ")";
      if (data.d.intronStyles && data.d.intronStyles[intronNum] == PSL_DOUBLE_LINE_INTRON) {
        var doubleLineHalfWidth = halfHeight > 4 ? 3 : 2;
        ctx.fillRect(startX, lineY + halfHeight - doubleLineHalfWidth, endX - startX, 1);
        ctx.fillRect(startX, lineY + halfHeight + doubleLineHalfWidth, endX - startX, 1);
      } else {
        ctx.fillRect(startX, lineY + halfHeight, endX - startX, 1);
      }
      // Don't draw arrows for "squish" mode
      if (halfHeight > 4) {
        this.type('bed').drawArrows(ctx, canvasWidth, lineY, halfHeight, startX, endX, data.d.strand);
      }
    }
  }
  
});

module.exports = BigPslFormat;