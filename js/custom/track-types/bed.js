// =================================================================
// = BED format: http://genome.ucsc.edu/FAQ/FAQformat.html#format1 =
// =================================================================
//
// bedDetail is a trivial extension of BED that is defined separately,
// although a BED file with >12 columns is assumed to be bedDetail track regardless of type.

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  convertUrlTemplateFormat = utils.convertUrlTemplateFormat,
  urlForFeature = utils.urlForFeature;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var LineMask = require('./utils/LineMask.js').LineMask;
var GeneticCode = require('./utils/GeneticCode.js').GeneticCode;

var BED_STANDARD_FIELDS = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'itemRgb',
    'blockCount', 'blockSizes', 'blockStarts'];
var BED_DETAIL_FIELDS = ['id', 'description'];

// Intended to be loaded into CustomTrack.types.bed
var BedFormat = {
  defaults: {
    itemRgb: 'off',
    colorByStrand: '',
    useScore: 0,
    group: 'user',
    priority: 'user',
    offset: 0,
    detail: false,
    url: '',
    htmlUrl: '',
    searchable: false, // FIXME: switch to on by default once searching is implemented for BEDs with triejs
    drawLimit: {squish: null, pack: null},
    bedPlusFields: null,
    // Should we color codons?
    // see https://genome.ucsc.edu/goldenpath/help/trackDb/trackDbHub.html#bigPsl_-_Pairwise_Alignments
    baseColorUseCds: null,
    // bppp value under which codons are drawn
    drawCodonsUnder: 1,
    // don't draw a codon letter if the codon is narrower than this, in px
    minCodonLetterWidth: 9,
    // how much sequence context do we need to draw codons? (we need sequence spanning most introns)
    // 90% of human introns are <11,000 bp in length (Sakharkar et al. 2004).
    // https://www.researchgate.net/publication/8491627_Distributions_of_exons_and_introns_in_the_human_genome
    mostIntronsBelow: 15000
  },
  
  init: function() {
    this.type().initOpts.call(this);
  },
  
  initOpts: function() {
    var self = this,
      o = self.opts,
      altColors = o.colorByStrand.split(/\s+/),
      validColorByStrand = altColors.length > 1 && _.all(altColors, self.validateColor);
    self.numStandardColumns = BED_STANDARD_FIELDS.length;
    o.useScore = self.isOn(o.useScore);
    o.itemRgb = self.isOn(o.itemRgb);
    o.searchable = self.isOn(o.searchable);
    if (self.typeArgs.length > 0 && /^\d+$/.test(self.typeArgs[0])) {
      self.numStandardColumns = parseInt10(self.typeArgs[0]);
    }
    if (o.bedPlusFields && !_.isArray(o.bedPlusFields)) {
      o.bedPlusFields = o.bedPlusFields.split(',');
    }
    if (/%s/.test(o.url)) { o.url = convertUrlTemplateFormat(o.url); }
    else if (o.url && !(/\$\$/).test(o.url)) { o.url += '$$'; }
    if (!validColorByStrand) { o.colorByStrand = ''; o.altColor = null; }
    else { o.altColor = altColors[1]; }
    self.expectsSequence = o.drawCodons = o.baseColorUseCds === "given";
    self.expectedSequencePadding = o.mostIntronsBelow;
  },
  
  // Given the feature's thickStart, thickEnd, and blocks, this saves an .exonFrame to each block.
  // Could perhaps use feature.extra.exonFrames, if it is given (as in bigGenePred) and >=0 for the block.
  calcExonFrames: function(feature, lineno) {
    var inCds = false,
      nextExonFrame, lastBlock;
    error = _.find(feature.blocks, function(block) {
      block.exonFrame = null;
      if (lastBlock && block.start < lastBlock.end) { return true; }
      if (!inCds && feature.thickStart >= block.start && feature.thickStart < block.end) {
        inCds = true;
        block.exonFrame = 0;
        nextExonFrame = (block.end - feature.thickStart) % 3;
      } else if (inCds) {
        block.exonFrame = nextExonFrame;
        if (feature.thickEnd <= block.end) { inCds = false; }
        else { nextExonFrame = (nextExonFrame + block.end - block.start) % 3; }
      }
      lastBlock = block;
    });
    
    if (error) {
      feature.blocks = null;
      this.warn("Blocks either overlap or are out of order at line " + lineno);
    }
  },

  parseLine: function(line, lineno) {
    var cols = BED_STANDARD_FIELDS,
      numStandardCols = this.numStandardColumns,
      bedPlusFields = this.opts.bedPlusFields || (numStandardCols >= 4 ? BED_DETAIL_FIELDS : null),
      feature = {extra: {}},
      fields = /\t/.test(line) ? line.split("\t") : line.split(/\s+/),
      chrPos, blockSizes;
    
    if (this.opts.detail) {
      numStandardCols = Math.min(fields.length - 2, 12);
      bedPlusFields = BED_DETAIL_FIELDS;
    }
    _.each(fields, function(v, i) {
      var bedPlusField;
      if (numStandardCols && i < numStandardCols) { feature[cols[i]] = v; }
      else {
        if (bedPlusFields && i - numStandardCols < bedPlusFields.length) { bedPlusField = bedPlusFields[i - numStandardCols]; }
        if (_.contains(BED_DETAIL_FIELDS, bedPlusField)) { feature[bedPlusField] = v; }
        else { feature.extra[bedPlusField] = v; }
      }
    });
    chrPos = this.browserOpts.chrPos[feature.chrom];
    lineno = lineno || 0;
    
    if (_.isUndefined(chrPos)) { 
      this.warn("Invalid chromosome '"+feature.chrom+"' at line " + (lineno + 1 + this.opts.lineNum));
      return null;
    } else {
      feature.score = _.isUndefined(feature.score) ? '?' : feature.score;
      feature.start = chrPos + parseInt10(feature.chromStart) + 1;
      feature.end = chrPos + parseInt10(feature.chromEnd) + 1;
      if (feature.end === feature.start) { feature.end += 0.1; feature.zeroWidth = true; }
      feature.blocks = null;
      // fancier BED features to express coding regions and exons/introns
      if (/^\d+$/.test(feature.thickStart) && /^\d+$/.test(feature.thickEnd)) {
        feature.thickStart = chrPos + parseInt10(feature.thickStart) + 1;
        feature.thickEnd = chrPos + parseInt10(feature.thickEnd) + 1;
        if (feature.thickEnd < feature.thickStart) {
          feature.thickStart = feature.thickEnd = null;
          this.warn("thickEnd position cannot precede thickStart at line " + (lineno + 1 + this.opts.lineNum));
        } else if (/^\d+(,\d*)*$/.test(feature.blockSizes) && /^\d+(,\d*)*$/.test(feature.blockStarts)) {
          feature.blocks = [];
          blockSizes = feature.blockSizes.split(/,/);
          _.each(feature.blockStarts.split(/,/), function(start, i) {
            if (start === '') { return; }
            var block = {start: feature.start + parseInt10(start)};
            block.end = block.start + parseInt10(blockSizes[i]);
            feature.blocks.push(block);
          });
          this.type('bed').calcExonFrames.call(this, feature, (lineno + 1 + this.opts.lineNum));
        }
      } else {
        feature.thickStart = feature.thickEnd = null;
      }
    }
    
    return feature;
  },

  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      data = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'});
    
    _.each(lines, function(line, lineno) {
      var feature = self.type().parseLine.call(self, line, lineno);
      if (feature) { data.add(feature); }
    });
    
    self.data = data;
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    self.isSearchable = self.opts.searchable;
    // self.expectsSequence is enabled in .initOpts() if codon drawing is enabled
    self.renderSequenceCallbacks = {};
    
    return true;
  },
  
  stackedLayout: function(intervals, width, calcPixInterval, lineNum) {
    // A lineNum function can be provided which can set/retrieve the line of already rendered datapoints
    // so as to not break a ranged feature that extends over multiple tiles.
    lineNum = _.isFunction(lineNum) ? lineNum : function() { return; };
    var lines = [],
      maxExistingLine = _.max(_.map(intervals, function(v) { return lineNum(v.data) || 0; })) + 1,
      // The intervals that have already been assigned to a line should be higher priority when calculating the layout.
      sortedIntervals = _.sortBy(intervals, function(v) { var ln = lineNum(v.data); return _.isUndefined(ln) ? 1 : -ln; });
    
    while (maxExistingLine-->0) { lines.push(new LineMask(width, 5)); }
    _.each(sortedIntervals, function(v) {
      var d = v.data,
        ln = lineNum(d),
        pInt = calcPixInterval(d),
        thickInt = d.thickStart !== null && calcPixInterval({start: d.thickStart, end: d.thickEnd}),
        blockInts = d.blocks !== null &&  _.map(d.blocks, calcPixInterval),
        i = 0,
        l = lines.length;
      if (!_.isUndefined(ln)) {
        if (lines[ln].conflict(pInt.tx, pInt.tw)) { console.log("Unresolvable LineMask conflict!"); }
        lines[ln].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
      } else {
        while (i < l && lines[i].conflict(pInt.tx, pInt.tw)) { ++i; }
        if (i == l) { lines.push(new LineMask(width, 5)); }
        lineNum(d, i);
        lines[i].add(pInt.tx, pInt.tw, {pInt: pInt, thickInt: thickInt, blockInts: blockInts, d: d});
      }
    });
    return _.map(lines, function(l) { return _.pluck(l.items, 'data'); });
  },
  
  codons: function(intervals, width, calcPixInterval, lineNum, start, end, sequence) {
    var codons = [],
      bppp = (end - start) / width,
      translator = GeneticCode(),
      seqPadding = this.expectedSequencePadding || 0;
    
    // Retrieves a subsequence from the provided sequence, but using 1-based right-open genomic coordinates.
    // Returns an empty string if the range is out of bounds of the provided data.
    function getSequence(left, right) {
      return sequence.slice(left - start + seqPadding, right - start + seqPadding);
    }

    _.each(intervals, function(interval) {
      var d = interval.data,
        ln = lineNum(d),
        revComp = d.strand === '-',
        thickStart = d.thickStart !== null ? d.thickStart : d.start,
        thickEnd = d.thickEnd !== null ? d.thickEnd : d.end,
        blocks = d.blocks !== null ? d.blocks : [{start: d.start, end: d.end, exonFrame: 0}],
        block, prevBlock, nextBlock, codon, pInt, jStart, cdsEnd, jEnd, translation;
      
      _.each(blocks, function(block) { block.partialCodons = block.partialCodons || [null, null]; });
      
      // Iterate over blocks in this interval to find codons in view, and create a drawable object for each./
      // Note: The following partial codon resolution algorithm fails on blocks smaller than 1 codon.
      for (var i = 0; i < blocks.length; i++) {
        block = blocks[i];
        prevBlock = i > 0 ? blocks[i - 1] : null;
        nextBlock = blocks[i + 1] || null;
        
        if (block.exonFrame === null) { continue; }
        
        jStart = Math.max(block.start, thickStart) - block.exonFrame;
        cdsEnd = Math.min(block.end, thickEnd);
        jEnd = Math.min(cdsEnd - 2, end);
        
        // Fast forward to the first codon position in view
        if (jStart < start) { jStart = start - ((start - jStart) % 3); }
        
        // Do we have to display a partial codon at the start of this block?
        // We always cache partial codon sequences to the block.
        if (jStart < block.start) {
          if (prevBlock === null || block.start - jStart > 2) { throw "Impossible intron pattern encountered!"; }
          codon = prevBlock.partialCodons[1] || getSequence(jStart - block.start + prevBlock.end, prevBlock.end);
          block.partialCodons[0] = getSequence(block.start, jStart + 3);
          codon += block.partialCodons[0];
          translation = translator(codon, revComp);
          if (translation) {
            pInt = calcPixInterval({start: block.start, end: jStart + 3});
            codons.push({ln: ln, pInt: pInt, partial: true, transl: translation});
          }
          jStart += 3;
        }
        
        // Handle all of the in-view, full codons for this block
        for (var j = jStart; j < jEnd; j += 3) {
          codon = getSequence(j, j + 3);
          translation = translator(codon, revComp);
          if (!translation) { continue; }
          pInt = calcPixInterval({start: j, end: j + 3});
          codons.push({ln: ln, pInt: pInt, partial: false, transl: translation});
        }
        
        // Do we have to display a partial codon at the end of this block?
        if (j >= cdsEnd - 2 && j < cdsEnd) {
          if (nextBlock === null) { continue; }   // Incomplete last codon.
          block.partialCodons[1] = getSequence(j, cdsEnd);
          codon = nextBlock.partialCodons[0] || getSequence(nextBlock.start, nextBlock.start + 3 - cdsEnd + j);
          codon = block.partialCodons[1] + codon;
          translation = translator(codon, revComp);
          if (translation) {
            pInt = calcPixInterval({start: j, end: cdsEnd});
            codons.push({ln: ln, pInt: pInt, partial: true, transl: translation});
          }
        }
      }
    });
    return codons;
  },
  
  prerender: function(start, end, density, precalc, callback) {
    var width = precalc.width,
      sequence = precalc.sequence,
      bppp = (end - start) / width,
      intervals = this.data.search(start, end),
      drawSpec = [],
      calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density=='pack');
    
    function lineNum(d, set) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(set)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = set);
      }
      return d.line && d.line[key]; 
    }
    
    if (density == 'dense') {
      _.each(intervals, function(v) {
        var pInt = calcPixInterval(v.data);
        pInt.v = v.data.score;
        drawSpec.push(pInt);
      });
    } else {
      if (!sequence) {
        // First drawing pass: draw the intervals, including possibly introns/exons and codon stripes
        drawSpec = {layout: this.type('bed').stackedLayout.call(this, intervals, width, calcPixInterval, lineNum)};
      } else {
        // Second drawing pass: draw codon sequences
        drawSpec = {
          codons: this.type('bed').codons.call(this, intervals, width, calcPixInterval, lineNum, start, 
                                               end, sequence)
        };
      }
      drawSpec.width = width;
      drawSpec.bppp = bppp;
    }
    return _.isFunction(callback) ? callback(drawSpec) : drawSpec;
  },
  
  // Fills out a URL template for a feature according to the standards for the `url` parameter of a UCSC trackDb
  // https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html
  calcUrl: function(url, feature) {
    var autoId = (/\t/).test(feature.id), // Only automatically generated id's could contain a tab character
      toReplace = {
        '$$': autoId || _.isUndefined(feature.id) ? feature.name : feature.id,
        '$T': this.opts.name,
        '$S': feature.chrom,
        '${': feature.chromStart,
        '$}': feature.chromEnd,
        '$D': this.browserOpts.genome.replace(/^ucsc:|:.*/ig, '')
      };
    _.each(toReplace, function(replacement, placeholder) {
      url = url.split(placeholder).join(replacement);
    });
    return url;
  },
  
  tipTipData: function(feature) {
    var tipTipData = {},
      autoId = (/\t/).test(feature.id); // Only automatically generated id's could contain a tab character
    if (!_.isUndefined(feature.description)) { tipTipData.description = feature.description; }
    if (!_.isUndefined(feature.score) && feature.score > 0) { tipTipData.score = feature.score; }
    _.extend(tipTipData, {
      position: feature.chrom + ':' + (parseInt10(feature.chromStart) + 1), // anything user-facing uses 1-based coordinates
      size: feature.chromEnd - feature.chromStart
    });
    if (this.opts.bedPlusFields) { _.extend(tipTipData, _.omit(feature.extra, function(v) { return v === ''; })); }
    // Display the ID column (from bedDetail) unless it was automatically generated
    if (!_.isUndefined(feature.id) && !autoId) { tipTipData.id = feature.id; }
    return tipTipData;
  },
  
  addArea: function(areas, data, i, lineHeight, urlTemplate) {
    var tipTipData = {},
      tipTipDataCallback = this.type().tipTipData,   // this permits inheriting track formats to override these
      customNameFunc = this.type().nameFunc,         // " "
      nameFunc = _.isFunction(customNameFunc) ? customNameFunc : utils.defaultNameFunc;
    if (!areas) { return; }
    
    if (!_.isFunction(tipTipDataCallback)) { tipTipDataCallback = this.type('bed').tipTipData; }
    tipTipData = tipTipDataCallback.call(this, data.d);
    
    areas.push([
      data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, // x1, y1, x2, y2
      nameFunc(data.d),                                                                 // name
      this.type('bed').calcUrl.call(this, urlTemplate, data.d),                         // href
      data.pInt.oPrev,                                                                  // continuation from previous tile?
      this.type('bed').calcFeatureColor.call(this, data) || null,
      null,
      tipTipData
    ]);
  },
  
  // Scales a score from 0-1000 into an alpha value between 0.2 and 1.0
  calcAlpha: function(value) { return Math.max(value, 166)/1000; },
  
  // Scales a score from 0-1000 into a color scaled between #cccccc and max Color
  calcGradient: function(maxColor, value) {
    var minColor = [230,230,230],
      valueColor = [];
    if (!_.isArray(maxColor)) { maxColor = _.map(maxColor.split(','), parseInt10); }
    _.each(minColor, function(v, i) { valueColor[i] = (v - maxColor[i]) * ((1000 - value) / 1000.0) + maxColor[i]; });
    return _.map(valueColor, parseInt10).join(',');
  },
  
  calcFeatureColor: function(itvl) {
    var self = this,
      o = self.opts,
      color = o.color;
    if (o.altColor && itvl.d.strand == '-') { color = o.altColor; }
    if (o.itemRgb && itvl.d.itemRgb && this.validateColor(itvl.d.itemRgb)) { color = itvl.d.itemRgb; }
    if (o.useScore) { color = self.type('bed').calcGradient(color, itvl.d.score); }
    return color;
  },
  
  drawArrows: function(ctx, canvasWidth, lineY, halfHeight, startX, endX, direction) {
    var arrowHeight = Math.min(halfHeight, 3),
      X1, X2;
    startX = Math.max(startX, 0);
    endX = Math.min(endX, canvasWidth);
    if (endX - startX < 5) { return; } // can't draw arrows in that narrow of a space
    if (direction !== '+' && direction !== '-') { return; } // invalid direction
    ctx.beginPath();
    // All the 0.5's here are due to <canvas>'s somewhat silly coordinate system 
    // http://diveintohtml5.info/canvas.html#pixel-madness
    X1 = direction == '+' ? 0.5 : arrowHeight + 0.5;
    X2 = direction == '+' ? arrowHeight + 0.5 : 0.5;
    for (var i = Math.floor(startX) + 2; i < endX - arrowHeight; i += 7) {
      ctx.moveTo(i + X1, lineY + halfHeight - arrowHeight + 0.5);
      ctx.lineTo(i + X2, lineY + halfHeight + 0.5);
      ctx.lineTo(i + X1, lineY + halfHeight + arrowHeight + 0.5);
    }
    ctx.stroke();
  },
  
  drawFeature: function(ctx, width, data, lineNum, lineHeight) {
    var self = this,
      o = self.opts,
      color = o.color,
      y = lineNum * lineHeight,
      halfHeight = Math.round(0.5 * (lineHeight - 1)),
      quarterHeight = Math.ceil(0.25 * (lineHeight - 1)),
      lineGap = lineHeight > 6 ? 2 : 1,
      thickOverlap = null,
      prevBInt = null;
    
    // First, determine and set the color we will be using
    // Note that the default color was already set in drawSpec
    if (o.itemRgb || o.altColor || o.useScore) {
      color = self.type('bed').calcFeatureColor.call(self, data);
      ctx.fillStyle = ctx.strokeStyle = "rgb(" + color + ")";
    }
    
    if (data.thickInt) {
      // The coding region is drawn as a thicker line within the gene
      if (data.blockInts) {
        // If there are exons and introns, draw the introns with a 1px line
        prevBInt = null;
        ctx.fillRect(data.pInt.x, y + halfHeight, data.pInt.w, 1);
        ctx.strokeStyle = color;
        _.each(data.blockInts, function(bInt) {
          if (bInt.w > 0 && bInt.x + bInt.w <= width && bInt.x >= 0) {
            ctx.fillRect(bInt.x, y + halfHeight - quarterHeight + 1, Math.max(bInt.w, 1), quarterHeight * 2 - 1);
          }
          thickOverlap = data.thickInt.w > 0 && utils.pixIntervalOverlap(bInt, data.thickInt);
          if (thickOverlap) {
            ctx.fillRect(thickOverlap.x, y + 1, Math.max(thickOverlap.w, 1), lineHeight - lineGap);
          }
          // If there are introns, arrows are drawn on the introns, not the exons.
          if (data.d.strand && prevBInt) {
            ctx.strokeStyle = "rgb(" + color + ")";
            self.type('bed').drawArrows(ctx, width, y, halfHeight, prevBInt.x + prevBInt.w, bInt.x, data.d.strand);
          }
          prevBInt = bInt;
        });
      } else {
        // We have a coding region but no introns/exons
        ctx.fillRect(data.pInt.x, y + halfHeight - quarterHeight + 1, data.pInt.w, quarterHeight * 2 - 1);
        ctx.fillRect(data.thickInt.x, y + 1, data.thickInt.w, lineHeight - lineGap);
      }
      // If there were no introns/exons, or if there was only one exon, draw the arrows directly on the exon.
      if (!data.blockInts || data.blockInts.length == 1) {
        ctx.strokeStyle = "white";
        self.type('bed').drawArrows(ctx, width, y, halfHeight, data.thickInt.x, data.thickInt.x + data.thickInt.w, data.d.strand);
      }
    } else {
      // Nothing fancy.  It's a box.
      ctx.fillRect(data.pInt.x, y + 1, Math.max(data.pInt.w, 1), lineHeight - lineGap);
      ctx.strokeStyle = "white";
      self.type('bed').drawArrows(ctx, width, y, halfHeight, data.pInt.x, data.pInt.x + data.pInt.w, data.d.strand);
    }
  },
  
  drawStripes: function(ctx, width, y, height, startX, endX, stripeWidth) {
    for (var x = startX; x < Math.min(endX, width); x += stripeWidth * 2) {
      ctx.fillRect(x, y, stripeWidth, height);
    }
  },
  
  drawCodons: function(ctx, width, data, lineNum, lineHeight, ppbp) {
    var self = this,
      o = self.opts,
      y = lineNum * lineHeight + 1,
      height = lineHeight - (lineHeight > 6 ? 2 : 1),
      stripeWidth = ppbp * 3,
      thickOverlap = null,
      exonFrame = null,
      firstStripeX = null;

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    
    function firstStripe(pInt, exonFrame) {
      exonFrame = exonFrame || 0;
      var startX = pInt.ox < 0 ? (pInt.ox % (stripeWidth * 2) + stripeWidth) : pInt.x + stripeWidth;
      return startX - (exonFrame * ppbp);
    }
    
    if (data.thickInt) {
      if (data.blockInts && data.blockInts.length > 1) {
        _.each(data.blockInts, function(bInt, i) {
          thickOverlap = data.thickInt.w > 0 && utils.pixIntervalOverlap(bInt, data.thickInt);
          if (thickOverlap && thickOverlap.w > 0) {
            exonFrame = data.d.blocks[i].exonFrame;
            firstStripeX = firstStripe(thickOverlap, exonFrame);
            self.type('bed').drawStripes(ctx, width, y, height, firstStripeX, thickOverlap.x + thickOverlap.w, stripeWidth);
          }
        });
      } else {
        firstStripeX = firstStripe(data.thickInt);
        self.type('bed').drawStripes(ctx, width, y, height, firstStripeX, data.thickInt.x + data.thickInt.w, stripeWidth);
      }
    } else {
      firstStripeX = firstStripe(data.pInt);
      self.type('bed').drawStripes(ctx, width, y, height, firstStripeX, data.pInt.x + data.pInt.w, stripeWidth);
    }
    
    ctx.fillStyle = "rgb(" + o.color + ")";
  },
  
  drawTranslatedCodon: function(ctx, width, codonData, lineHeight) {
    var self = this,
      o = self.opts,
      pInt = codonData.pInt,
      textLeft = pInt.oPrev ? pInt.ox : pInt.x,
      textRight = pInt.x + pInt.w + pInt.ow,
      textX = (textLeft + textRight) * 0.5,
      y = codonData.ln * lineHeight + 1,
      height = lineHeight - (lineHeight > 6 ? 2 : 1),
      bgColors = {"M": "0,255,0", "*": "255,0,0"},  // note, alternative start sites are lowercase "m"
      bgColor = bgColors[codonData.transl.special],
      textColor = codonData.partial ? '122,241,255' : '255,255,255';
        
    if (pInt.w > 0 && pInt.x + pInt.w <= width && pInt.x >= 0) {
      if (bgColor) {
        ctx.fillStyle = 'rgb(' + bgColor + ')';
        ctx.fillRect(pInt.x, y, codonData.pInt.w, height);
      }
      if (textRight - textLeft >= o.minCodonLetterWidth && lineHeight > 10) {
        ctx.fillStyle = 'rgb(' + textColor + ')';
        ctx.fillText(codonData.transl.aa, textX, y + height - 2);
      }
    }
  },
  
  drawSpec: function(canvas, drawSpec, density) {
    var self = this,
      o = self.opts,
      ppbp = drawSpec.bppp && 1 / drawSpec.bppp,
      ctx = canvas.getContext,
      urlTemplate = o.url ? o.url : 'javascript:void("' + o.name + ':$$")',
      drawLimit = o.drawLimit && o.drawLimit[density],
      drawCodons = o.drawCodons && drawSpec.bppp <= o.drawCodonsUnder,
      lineHeight = density == 'pack' ? 15 : 6,
      color = o.color,
      areas = null;
    
    if (!urlTemplate.match(/\$\$/)) { urlTemplate += '$$'; }
    
    if (!ctx) { throw "Canvas not supported"; }
    // TODO: I disabled regenerating areas here, which assumes that lineNum remains stable across re-renders. Should check on this.
    if (density == 'pack' && !self.areas[canvas.id]) { areas = self.areas[canvas.id] = []; }
    
    if (density == 'dense') {
      canvas.unscaledHeight(15);
      ctx = canvas.getContext('2d');
      ctx.fillStyle = "rgb("+color+")";
      _.each(drawSpec, function(pInt) {
        if (o.useScore) { ctx.fillStyle = "rgba(" + self.type('bed').calcGradient(color, pInt.v) + ")"; }
        ctx.fillRect(pInt.x, 1, pInt.w, 13);
      });
    } else if (drawSpec.codons) {
      // Now that we have sequence data, draw codon translations on *top* of the already drawn features
      ctx = canvas.getContext('2d');
      ctx.font = "12px 'Menlo','Bitstream Vera Sans Mono','Consolas','Lucida Console',monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'baseline';
      _.each(drawSpec.codons, function(codon) {
        self.type('bed').drawTranslatedCodon.call(self, ctx, drawSpec.width, codon, lineHeight);  
      });
    } else {
      if ((drawLimit && drawSpec.layout && drawSpec.layout.length > drawLimit) || drawSpec.tooMany) { 
        canvas.unscaledHeight(0);
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
        return;
      }
      // A tile that successfully rendered should always be at least 1px high (because of genobrowser's densityOrder algorithm)
      canvas.unscaledHeight(Math.max(drawSpec.layout.length * lineHeight, 1));
      ctx = canvas.getContext('2d');
      ctx.fillStyle = ctx.strokeStyle = "rgb("+color+")";
      _.each(drawSpec.layout, function(l, i) {
        _.each(l, function(data) {
          self.type('bed').drawFeature.call(self, ctx, drawSpec.width, data, i, lineHeight);  
          self.type('bed').addArea.call(self, areas, data, i, lineHeight, urlTemplate);
          if (drawCodons) { self.type('bed').drawCodons.call(self, ctx, drawSpec.width, data, i, lineHeight, ppbp); }
        });
      });
    }
  },

  render: function(canvas, start, end, density, callback) {
    var self = this;
    self.prerender(start, end, density, {width: canvas.unscaledWidth()}, function(drawSpec) {
      var callbackKey = start + '-' + end + '-' + density;
      self.type().drawSpec.call(self, canvas, drawSpec, density);
      
      // Have we been waiting to draw sequence data too? If so, do that now, too.
      if (_.isFunction(self.renderSequenceCallbacks[callbackKey])) {
        self.renderSequenceCallbacks[callbackKey]();
        delete self.renderSequenceCallbacks[callbackKey];
      }
      
      if (_.isFunction(callback)) { callback(); }
    });
  },
  
  renderSequence: function(canvas, start, end, density, sequence, callback) {
    var self = this,
      width = canvas.unscaledWidth(),
      drawCodons = self.opts.drawCodons,
      drawCodonsUnder = self.opts.drawCodonsUnder;
    
    // If we're not drawing codons or we weren't able to fetch sequence, there is no reason to proceed.
    if (!drawCodons || !sequence || (end - start) / width > drawCodonsUnder) { return false; }

    function renderSequenceCallback() {
      self.prerender(start, end, density, {width: width, sequence: sequence}, function(drawSpec) {
        self.type('bed').drawSpec.call(self, canvas, drawSpec, density);
        if (_.isFunction(callback)) { callback(); }
      });
    }
    
    // Check if the canvas was already rendered (by lack of the class 'unrendered').
    // If yes, go ahead and execute renderSequenceCallback(); if not, save it for later.
    if ((' ' + canvas.className + ' ').indexOf(' unrendered ') > -1) {
      self.renderSequenceCallbacks[start + '-' + end + '-' + density] = renderSequenceCallback;
    } else {
      renderSequenceCallback();
    }
  },

  loadOpts: function($dialog) {
    var o = this.opts,
      colorByStrandOn = /\d+,\d+,\d+\s+\d+,\d+,\d+/.test(o.colorByStrand),
      colorByStrand = colorByStrandOn ? o.colorByStrand.split(/\s+/)[1] : '0,0,0';
    $dialog.find('[name=colorByStrandOn]').attr('checked', !!colorByStrandOn);
    $dialog.find('[name=colorByStrand]').val(colorByStrand).change();
    $dialog.find('[name=useScore]').attr('checked', this.isOn(o.useScore));    
    $dialog.find('[name=url]').val(o.url);
  },
  
  saveOpts: function($dialog) {
    var o = this.opts,
      colorByStrandOn = $dialog.find('[name=colorByStrandOn]').is(':checked'),
      colorByStrand = $dialog.find('[name=colorByStrand]').val(),
      validColorByStrand = this.validateColor(colorByStrand);
    o.colorByStrand = colorByStrandOn && validColorByStrand ? o.color + ' ' + colorByStrand : '';
    o.useScore = $dialog.find('[name=useScore]').is(':checked') ? 1 : 0;
    o.url = $dialog.find('[name=url]').val();
    this.type('bed').initOpts.call(this);
  }
};

module.exports = BedFormat;