// ==========================================================================
// = bigChain format: https://genome.ucsc.edu/goldenpath/help/bigChain.html =
// ==========================================================================

// The interesting aspect of this bigBed-derived format is that the highest level (the "chain" level) of each alignment
// is stored in the primary bigBed file, but the "links" (which are drawn analogously to "blocks" in BED tracks) are
// stored in a separate bigBed file

var bigbed = require('./bigbed.js'),
  utils = require('./utils/utils.js'),
  floorHack = utils.floorHack;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

var CHAIN_SINGLE_LINE_INTRON = 0;
var CHAIN_DOUBLE_LINE_INTRON = 1;

// Intended to be loaded into CustomTrack.types.biggenepred
var BigChainFormat = _.extend({}, bigbed, {
  defaults: _.extend({}, bigbed.defaults, {
    numStandardColumns: 6,
    bedPlusFields: ['tSize', 'qName', 'qSize', 'qStart', 'qEnd', 'chainScore'],
    itemRgb: true
  }),
  
  init: function() {
    if (!this.opts.linkDataUrl) {
      throw new Error("Required parameter linkDataUrl not found for bigChain track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.type('bigbed').initOpts();
  },
  
  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxParams = {url: self.opts.bigDataUrl, link_url: self.opts.linkDataUrl, density: 'pack'},
      ajaxUrl = self.ajaxDir() + 'bigchain.php?' + $.param(ajaxParams),
      remote;
    
    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      // Note: bigBed tools expect regions in 0-based, right-OPEN coordinates.
      range = self.chrRange(start, end, true).join(' ');
      $.ajax(ajaxUrl, {
        type: range.length > 500 ? 'POST' : 'GET',
        data: { range: range },
        success: function(data) {
          var parts = _.map(data.split('\n\n'), function(part) { 
            return _.filter(part.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; })
          });
          var chainLines = parts[0],
            linkLines = parts[1];
          
          var intervals = _.map(chainLines, function(line) { 
            // This allows formats inheriting from `bigbed` to override parseLine(); otherwise the `bed` method is used
            var itvl = self.type().parseLine(line);
            // For bigChains, intervals must have unique `name` fields, which is the ID that the bigLink intervals refer to
            itvl.id = itvl.name;
            // We override a few fields to help the `bed` type's functions draw links from the bigLink file as blocks
            itvl.thickStart = itvl.start;
            itvl.thickEnd = itvl.end;
            itvl.blocks = [];
            itvl.intronStyles = [];
            itvl._blocksByStartEnd = {};
            return itvl;
          });
          
          function moreCacheActions(cache) {
            // Insert the links as blocks on the corresponding chain
            _.each(linkLines, function(line) {
              var link = line.split("\t"),
                chrPos = self.browserOpts.chrPos[link[0]],
                itvl = cache.get(link[3]),
                block = {qStart: parseInt10(link[4])},
                insIndex, intronSpliceArgs;
              
              if (_.isUndefined(chrPos)) { this.warn("Invalid chromosome '"+link[0]); return; }
              if (itvl === null) { this.warn("Could not find chainId '"+link[3]); return; }
              
              block.start = chrPos + parseInt10(link[1]) + 1;
              block.end = chrPos + parseInt10(link[2]) + 1;
              if (!!itvl.data._blocksByStartEnd[block.start + ',' + block.end]) { return; }
              
              insIndex = _.sortedIndex(itvl.data.blocks, block, 'start');
              itvl.data.blocks.splice(insIndex, 0, block);
              itvl.data._blocksByStartEnd[block.start + ',' + block.end] = block;
              
              // Recalculate intronStyles adjacent to the inserted block
              if (itvl.data.blocks.length <= 1) { return; }
              intronSpliceArgs = insIndex == 0 ? [0, 0] : [insIndex - 1, 1];
              if (insIndex > 0) {
                var prevBlock = itvl.data.blocks[insIndex - 1],
                  single = prevBlock.end - prevBlock.start == block.qStart - prevBlock.qStart;
                intronSpliceArgs.push(single ? CHAIN_SINGLE_LINE_INTRON : CHAIN_DOUBLE_LINE_INTRON);
              }
              if (insIndex < itvl.data.blocks.length - 1) {
                var nextBlock = itvl.data.blocks[insIndex + 1],
                  single = block.end - block.start == nextBlock.qStart - block.qStart;
                intronSpliceArgs.push(single ? CHAIN_SINGLE_LINE_INTRON : CHAIN_DOUBLE_LINE_INTRON);
              }
              Array.prototype.splice.apply(itvl.data.intronStyles, intronSpliceArgs);
            });
          }
          
          storeIntervals(intervals, moreCacheActions);
        }
      });
    });
      
    self.data = {cache: cache, remote: remote};
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    self.isSearchable = self.opts.searchable;
    // self.expectsSequence is enabled in .initOpts() if codon drawing is enabled
    self.renderSequenceCallbacks = {};
    
    return true;
  },
  
  predrawIntrons: function(ctx, lineY, halfHeight, startX, width) {
    // The default intronStyle for chain tracks is a double line, because this is far more common for long gaps
    // than a single line.
    var doubleLineHalfWidth = halfHeight > 4 ? 3 : 2;
    ctx.fillRect(startX, lineY + halfHeight - doubleLineHalfWidth, width, 1);
    ctx.fillRect(startX, lineY + halfHeight + doubleLineHalfWidth, width, 1);
  },
  
  drawIntron: function(ctx, canvasWidth, lineY, halfHeight, startX, endX, color, data, intronNum) {
    if (data.d.strand && endX - startX > 0 && startX <= canvasWidth && endX >= 0) {
      ctx.strokeStyle = "rgb(" + color + ")";
      if (data.d.intronStyles && data.d.intronStyles[intronNum] == CHAIN_SINGLE_LINE_INTRON) {
        var doubleLineHalfWidth = halfHeight > 4 ? 3 : 2;
        ctx.clearRect(startX, lineY + halfHeight - doubleLineHalfWidth, endX - startX, doubleLineHalfWidth * 2 + 1);
        ctx.fillRect(startX, lineY + halfHeight, endX - startX, 1);
      } 
    }
  },
  
  drawExon: function(ctx, canvasWidth, lineY, blockInt, halfHeight, quarterHeight, lineHeightNoGap, color, data) {
    var prevStrokeStyle = ctx.strokeStyle,
      thickOverlap = this.type('bed').drawExon.apply(this, arguments),
      endX;
    if (thickOverlap) {
      endX = thickOverlap.x + thickOverlap.w;
      ctx.strokeStyle = this.contrastColor(color);
      this.type('bed').drawArrows(ctx, canvasWidth, lineY, halfHeight, thickOverlap.x, endX, data.d.strand);
      ctx.strokeStyle = prevStrokeStyle;
    }
  },

  nameFunc: function(d) {
    var qStartK = '';
    if (d.extra.qName && d.extra.qSize) {
      qStartK = Math.floor((d.strand == '-' ? d.extra.qSize - d.extra.qEnd : d.extra.qStart) / 1000) + 'k';
    }
    return utils.strip(qStartK ? (d.extra.qName + ' ' + qStartK) : (d.name || d.id || ''));
  },
  
  calcFeatureColor: function(itvl) {
    var self = this,
      o = self.opts,
      color = o.color;
    if (itvl.d.itemRgb && this.validateColor(itvl.d.itemRgb)) { color = itvl.d.itemRgb; }
    else if (itvl.d.extra.qName) { color = utils.colorByChr(itvl.d.extra.qName); }
    return color;
  }
  
});

module.exports = BigChainFormat;