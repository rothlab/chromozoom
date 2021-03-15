// ======================================================================================
// = This is a special CustomTrack type that handles drawing of the base position ruler =
// = and the chrBands ideogram                                                          =
// ======================================================================================

var utils = require('./utils/utils.js'),
  floorHack = utils.floorHack,
  parseInt10 = utils.parseInt10,
  strip = utils.strip;

// Intended to be loaded into CustomTrack.types.ruler
var RulerFormat = {
  defaults: {
    name: 'Base Position',
    description: 'Base position and chromosome ideograms',
    chrLabelFont: "bold 21px 'helvetica neue','helvetica','arial',sans-serif",
    giemsaColors: {
      gneg: '#e3e3e3',
      gpos25: '#8e8e8e',
      gpos50: '#555',
      stalk: '#555',
      gpos75: '#393939',
      gpos100: '#000',
      gvar: '#000',
      acen: '#963232'
    },
    bandsTop: 23,
    bandsHeight: 25
  },
  
  init: function() {
    this.type().initOpts();
    self.data = null;
  },
  
  initOpts: function() {
    var self = this,
      o = self.opts;
  },
  
  chrAt: function(pos) {
    var o = this.opts,
      chrLabels = this.browserOpts.chrLabels,
      chrIndex = _.sortedIndex(chrLabels, {p: pos}, function(v) { return v.p; });
    return chrIndex > 0 ? chrLabels[chrIndex - 1] : null;
  },

  parse: function() {
    return true;
  },
  
  drawChrLabelsAndTicks: function(canvas, start, end, drawTicks, offsetForNtText) {
    var self = this,
      o = self.opts,
      chr = self.type().chrAt(start),
      bpPerTile = end - start,
      scale = Math.round(Math.log(bpPerTile / 10)/Math.log(10)*2),
      tooLong = start.toString().length > 8 && scale < 6,
      step = scale % 2 ? (tooLong ? 5 : 2) * Math.pow(10, floorHack(scale/2)) : Math.pow(10, scale/2),
      majorStep = scale % 2 ? (tooLong ? [step * 2, step * 2] : [step * 5, step * 5]) : [step * 5, step * 10],
      startTicksAt = floorHack((start - chr.p) / step) * step,
      chrAtTileEnd = self.type().chrAt(end),
      chrBands = self.browserOpts.chrBands || null,
      canvasWidth = canvas.unscaledWidth(), 
      canvasHeight = canvas.unscaledHeight(),
      textY = chrBands ? 16 : (offsetForNtText ? 10 : 16),
      chrTextUpTo = -Infinity,
      ctx = canvas.getContext('2d'),
      chrText, x, unit, major, minor, isMajor;

    ctx.font = o.font;
    ctx.textAlign = 'start';
  
    // First, draw the end of the genome if it is on this tile (so any overlapping ticks are drawn on top)
    if (chrAtTileEnd.end) {
      x = ((chrAtTileEnd.p - start + 0.5) / bpPerTile * canvasWidth);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(x - 1, 0, 2, canvasHeight);
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(x + 1, 0, canvasWidth - x - 1, canvasHeight);
      ctx.fillStyle = '#000000';
    }

    // Step through all of the possible ticks
    for (var t = startTicksAt; t + chr.p < end + step; t += step) {
      // Do we need to advance to the next chr?
      if (t > chr.w) {
        chr = self.type().chrAt(chr.p + chr.w + 1);
        t = 0;
      }

      x = ((t + chr.p - start + 0.5) / bpPerTile * canvasWidth);
      if (t == 0) {
        // This is a new chr boundary; draw a chrLabel
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(x - 1, 0, 2, canvasHeight);
        if (chr.end) { break; }
        ctx.fillStyle = '#000000';
        ctx.font = o.chrLabelFont;
        chrText = chr.n.replace(/^chr/, '');
        chrTextUpTo = x + Math.min(ctx.measureText(chrText).width + 4, chr.w / bpPerTile * canvasWidth);
        ctx.clearRect(x + 1, 0, Math.max(0, chrTextUpTo - x - 1), o.bandsTop);
        if (chrTextUpTo - x > 8) { ctx.fillText(chrText, x + 2, textY + 3, chrTextUpTo - x - 4); }
        ctx.font = o.font;
      } else if (drawTicks && x > chrTextUpTo) {
        // Draw a major or minor tick
        unit = _.find([[1000000, 'm'], [1000, 'k'], [1, '']], function(v) { return v[0] <= step; }),
        major = floorHack(t / majorStep[1]),
        minor = (t / unit[0]).toString().substr(major > 0 ? major.toString().length : 0),
        isMajor = !(t % majorStep[0]);
        if (isMajor) {
          ctx.font = "bold " + o.font;
          if (major) {
            ctx.textAlign = 'end';
            ctx.fillText(major, x - 1, textY);
          }
          ctx.textAlign = 'start';
          ctx.fillRect(x, offsetForNtText ? 1 : 3, 1, 19);
        } else {
          ctx.fillStyle = '#666666';
          ctx.fillRect(x, offsetForNtText ? 1 : 7, 1, 14);
          ctx.fillStyle = '#000000';
        }
        ctx.fillText(minor + (isMajor ? unit[1] : ''), x + 2, textY);
        if (isMajor) { ctx.font = o.font; }
      }
    }
  },
  
  drawChrBands: function(canvas, start, end) {
    var self = this,
      chrBands = self.browserOpts.chrBands || null;
    if (!chrBands) { return; }
    
    var o = self.opts,
      bpPerTile = end - start,
      giemsaColors = o.giemsaColors,
      whiteLabel = {gpos50: true, stalk: true, gpos75: true, gpos100: true, gvar: true},
      firstBandIndex = _.sortedIndex(chrBands, [0, 0, start], function(v) { return v[2]; }),
      lastBandIndex = _.sortedIndex(chrBands, [0, end], function(v) { return v[1]; }),
      bandsToDraw = chrBands.slice(firstBandIndex, lastBandIndex),
      bandsTop = o.bandsTop,
      canvasWidth = canvas.unscaledWidth(),
      zoom = (end - start) / canvasWidth,
      ctx = canvas.getContext('2d');
 
    ctx.font = o.font;
    ctx.textAlign = 'center';
    _.each(bandsToDraw, function(band, i) {
      var leftUnclipped = (band[1] - start) / zoom,
        left = Math.max(leftUnclipped, 0),
        rightUnclipped = (band[2] - start) / zoom,
        right = Math.min(rightUnclipped, canvasWidth),
        width = right - left,
        acenHeight = 7,
        prevBand = chrBands[firstBandIndex + i - 1],
        unclippedWidth, leftClipRatio, rightClipRatio, leftHeight, rightHeight;
   
      if (band[4] == 'acen') {
        unclippedWidth = rightUnclipped - leftUnclipped;
        leftHeight = (1 - (left - leftUnclipped) / unclippedWidth) * acenHeight;
        rightHeight = (rightUnclipped - right) / unclippedWidth * acenHeight;
        if (band[3].substr(0, 1) == 'q' || (prevBand && prevBand[4] == 'acen')) { 
          leftHeight = acenHeight - leftHeight;
          rightHeight = acenHeight - rightHeight;
        }
        ctx.fillStyle = giemsaColors.acen;
        ctx.beginPath();
        ctx.moveTo(left, bandsTop + 9 - leftHeight);
        ctx.lineTo(right, bandsTop + 9 - rightHeight);
        ctx.lineTo(right, bandsTop + 10 + rightHeight);
        ctx.lineTo(left, bandsTop + 10 + leftHeight);
        ctx.lineTo(left, bandsTop + 9 - leftHeight);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(left, bandsTop + 2, width, 1);
        ctx.fillRect(left, bandsTop + 16, width, 1);
        ctx.fillStyle = giemsaColors[band[4]];
        ctx.fillRect(left, bandsTop + 3, width, 13);
        if (width > band[3].length * 10) {
          ctx.fillStyle = whiteLabel[band[4]] ? '#fff' : '#000';
          ctx.fillText(band[3], left + width / 2, bandsTop + 14);
        }
      }
    });
  },

  render: function(canvas, start, end, renderOpts, callback) {
    var self = this,
      o = self.opts,
      drawTicks = renderOpts.drawTicks,
      offsetForNtText = renderOpts.offsetForNtText;
    
    canvas.unscaledWidth(renderOpts.canvasWidth);
    if (self.browserOpts.chrBands && renderOpts.drawIdeograms) {
      self.type().drawChrBands(canvas, start, end);
    }
    if (renderOpts.drawChrLabels) {
      self.type().drawChrLabelsAndTicks(canvas, start, end, drawTicks, offsetForNtText);
    }
    
    if (_.isFunction(callback)) { callback({canvas: canvas}); }
  },
  
  renderSequence: function(canvas, start, end, density, sequence, callback) {
    var self = this,
      width = canvas.unscaledWidth();
    
    //FIXME
    
    if (_.isFunction(callback)) { callback({canvas: canvas}); }
  },

  loadOpts: function($dialog) {
    var o = this.opts;
  },
  
  saveOpts: function($dialog) {
    var o = this.opts;
    this.type().initOpts();
  }
};

module.exports = RulerFormat;