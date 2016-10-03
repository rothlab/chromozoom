// ====================================================================
// = vcfTabix format: http://genome.ucsc.edu/goldenPath/help/vcf.html =
// ====================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  floorHack = utils.floorHack,
  guessChrScheme = utils.guessChrScheme,
  shortHash = utils.shortHash;
var IntervalTree = require('./utils/IntervalTree.js').IntervalTree;
var RemoteTrack = require('./utils/RemoteTrack.js').RemoteTrack;

// Intended to be loaded into CustomTrack.types.vcftabix
var VcfTabixFormat = {
  defaults: {
    priority: 100,
    drawLimit: {squish: 1000, pack: 200},
    // Data for how many nts should be fetched in one go? (0 means guess this from the index's summary stats)
    optimalFetchWindow: 0,
    // Above what tile width (in nts) do we avoid fetching data altogether? (0 means guess this from the index's summary stats)
    maxFetchWindow: 0,
    chromosomes: '',
    // The following can be "ensembl_ucsc" or "ucsc_ensembl" to attempt auto-crossmapping of reference contig names
    // between the two schemes, which IGV does, but is a perennial issue: https://www.biostars.org/p/10062/
    // For stricter correctness, we'd need all the mappings in here https://github.com/dpryan79/ChromosomeMappings
    convertChrScheme: "auto",
  },

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for vcfTabix track at " + 
          JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }

    this.browserChrScheme = guessChrScheme(_.keys(this.browserOpts.chrPos));
  },
  
  applyOpts: function() {
    var self = this,
      o = this.opts;
    
    // Ensures that options and derived properties are equal across Web Worker and DOM contexts
    this.syncProps(['opts']);
  },
  
  parseLine: function(line) {
    var fields = line.split('\t'),
      contig = fields[0],
      o = this.opts,
      data = {}, info = {};
    // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
    // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
    switch (o.convertChrScheme == "auto" ? this.data.info.convertChrScheme : o.convertChrScheme) {
      case 'ucsc_ensembl': contig = contig.replace(/^chr/, ''); break;
      case 'ensembl_ucsc': contig = (/^(\d\d?|X)$/.test(contig) ? 'chr' : '') + contig; break;
    }
    if (fields[7]) {
      _.each(fields[7].split(';'), function(l) { l = l.split('='); if (l.length > 1) { info[l[0]] = l[1]; } });
    }
    data.start = this.browserOpts.chrPos[contig] + parseInt10(fields[1]);
    data.id = fields[2];
    data.end = data.start + 1;
    data.ref = fields[3];
    data.alt = fields[4];
    data.qual = parseFloat(fields[5]);
    data.info = info;
    // Use a strategy similar to BioPerl's Bio::DB:BigBed strategy for deduplicating re-fetched intervals,
    // which is to use a combination of several fields to create a (hopefully) unique ID.
    // We need this because VCFs aren't required to have a unique ID for every line.
    if (data.id == '.' || data.id == '') {
      data.id = [contig, fields[1], data.ref, data.alt, shortHash(fields[7])].join("\t");
    }
    return data;
  },

  parse: function(lines) {
    var self = this,
      middleishPos = self.browserOpts.genomeSize / 2,
      cache = new IntervalTree(floorHack(middleishPos), {startKey: 'start', endKey: 'end'}),
      ajaxUrl = self.ajaxDir() + 'tabix.php',
      remote;

    remote = new RemoteTrack(cache, function(start, end, storeIntervals) {
      var o = self.opts;
      range = self.chrRange(start, end);
      // Convert automatically between Ensembl style 1, 2, 3, X <--> UCSC style chr1, chr2, chr3, chrX as configured/autodetected
      // Note that chrM is NOT equivalent to MT https://www.biostars.org/p/120042/#120058
      switch (o.convertChrScheme == "auto" ? self.data.info.convertChrScheme : o.convertChrScheme) {
        case 'ensembl_ucsc': range = _.map(range, function(r) { return r.replace(/^chr/, ''); }); break;
        case 'ucsc_ensembl': range = _.map(range, function(r) { return r.replace(/^(\d\d?|X):/, 'chr$1:'); }); break;
      }
      $.ajax(ajaxUrl, {
        data: {range: range, url: self.opts.bigDataUrl},
        success: function(data) {
          var lines = _.filter(data.split('\n'), function(l) { var m = l.match(/\t/g); return m && m.length >= 2; });
          var intervals = _.map(lines, function(l) { 
            var itvl = self.type().parseLine.call(self, l);
            return itvl;
          });
          storeIntervals(intervals);
        }
      });
    });
    
    self.data = {cache: cache, remote: remote, info: {}};
    self.heights = {max: null, min: 15, start: 15};
    self.sizes = ['dense', 'squish', 'pack'];
    self.mapSizes = ['pack'];
    
    return true;
  },
  
  // Before the RemoteTrack can start caching data, we need to use general info on the vcfTabix track to setup its binning scheme.
  // We defer this in a .finishSetup() method because it's potentially expensive HTTP GET that is only necessary if the track
  // is actually going to be displayed in the browser.
  finishSetup: function() {
    var self = this,
      ajaxUrl = self.ajaxDir() + 'tabix.php',
      sampleWindow = 100000,
      infoChrRange = self.chrRange(Math.round(self.browserOpts.pos), Math.round(self.browserOpts.pos + sampleWindow)),
      remote = self.data.remote;
    
    $.ajax(ajaxUrl, {
      data: {info: 3, range: infoChrRange, url: self.opts.bigDataUrl},
      success: function(data) {
        var o = self.opts,
          infoParts = data.split("\n\n"),
          vcfChrs = infoParts[0].split("\n"),
          vcfSample;
      
        if (infoParts[0] == '' || infoParts.length == 1) { throw new Error("tabix failed to retrieve data for this track."); }
        self.data.info.chrScheme = chrScheme = guessChrScheme(vcfChrs);
        if (chrScheme && self.browserChrScheme) {
          self.data.info.convertChrScheme = chrScheme != self.browserChrScheme ? chrScheme + '_' + self.browserChrScheme : null;
        }
      
        vcfSample = infoParts[1];
        // Set maxFetchWindow to avoid overfetching data
        if (!o.maxFetchWindow) {
          // FIXME: vcfSample.length is capped at 500, so we may have to detect that and shrink the sampleWindow
          var meanItemsPerBp = vcfSample.length / sampleWindow,
            maxItemsToDraw = _.max(_.values(o.drawLimit));
          o.maxFetchWindow = maxItemsToDraw / meanItemsPerBp;
          o.optimalFetchWindow = Math.floor(o.maxFetchWindow / 3);
        }
        self.type().applyOpts.call(self);
        
        remote.setupBins(self.browserOpts.genomeSize, o.optimalFetchWindow, o.maxFetchWindow);
      }
    });
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      data = self.data,
      bppp = (end - start) / width,
      range = self.chrRange(start, end);
    
    function lineNum(d, setTo) {
      var key = bppp + '_' + density;
      if (!_.isUndefined(setTo)) { 
        if (!d.line) { d.line = {}; }
        return (d.line[key] = setTo);
      }
      return d.line && d.line[key]; 
    }
    
    function nameFunc(fields) {
      var ref = fields.ref || '',
        alt = fields.alt || '';
      return (ref.length > alt.length ? ref : alt) || '';
    }
    
    // Don't even attempt to fetch the data if we can reasonably estimate that we will fetch too many rows (>500 features), 
    // as this will only delay other requests.
    if (self.opts.maxFetchWindow > 0 && (end - start) > self.opts.maxFetchWindow) {
      callback({tooMany: true});
    } else {
      self.data.remote.fetchAsync(start, end, function(intervals) {        
        var calcPixInterval, drawSpec = [];
        if (intervals.tooMany) { return callback(intervals); }
        calcPixInterval = new utils.pixIntervalCalculator(start, width, bppp, density == 'pack', nameFunc);
        if (density == 'dense') {
          _.each(intervals, function(itvl) {
            drawSpec.push(calcPixInterval(itvl.data));
          });
        } else {
          drawSpec = {layout: self.type('bed').stackedLayout.call(self, intervals, width, calcPixInterval)};
          drawSpec.width = width;
        }
        callback(drawSpec);
      });
    }
  },

  render: function(canvas, start, end, density, callback) {
    var ctx = canvas.getContext && canvas.getContext('2d'),
      urlTemplate = this.opts.url ? this.opts.url : 'javascript:void("'+this.opts.name+':$$")',
      lineHeight = density == 'pack' ? 27 : 6,
      colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,255,0', other:'114,41,218'},
      drawLimit = this.opts.drawLimit && this.opts.drawLimit[density],
      areas = null;

    if (!ctx) { throw "Canvas not supported"; }
    // TODO: I disabled regenerating areas here, which assumes that lineNum remains stable across re-renders. Should check on this.
    if (density == 'pack' && !this.areas[canvas.id]) { areas = this.areas[canvas.id] = []; }
    ctx.fillStyle = "rgb(0,0,0)";

    this.prerender(start, end, density, {width: canvas.width}, function(drawSpec) {
      if ((drawLimit && drawSpec.length > drawLimit) || drawSpec.tooMany) { 
        canvas.height = 0;
        // This applies styling that indicates there was too much data to load/draw and that the user needs to zoom to see more
        canvas.className = canvas.className + ' too-many';
      } else if (density == 'dense') {
        canvas.height = 15;
        _.each(drawSpec, function(pInt) {
          ctx.fillRect(pInt.x, 1, pInt.w, 13);
        });
      } else {
        canvas.height = drawSpec.layout.length * lineHeight;
        _.each(drawSpec.layout, function(l, i) {
          _.each(l, function(data) {
            var altColor, refColor;
            if (density == 'pack') {
              refColor = colors[data.d.ref.toLowerCase()] || colors.other;
              altColor = colors[data.d.alt.toLowerCase()] || colors.other;
              ctx.fillStyle = "rgb(" + altColor + ")"; 
            }
            ctx.fillRect(data.pInt.x, i * lineHeight + 1, data.pInt.w, lineHeight - 1);
            if (areas) {
              areas.push([
                data.pInt.x, i * lineHeight + 1, data.pInt.x + data.pInt.w, (i + 1) * lineHeight, //x1, x2, y1, y2
                data.d.ref + ' > ' + data.d.alt, // title
                urlTemplate.replace('$$', data.d.id), // href
                data.pInt.oPrev, // continuation from previous tile?
                altColor, // label color
                data.d.ref + "[" + refColor + "]" + "\n" + data.d.alt, // label
                data.d.info
              ]);
            }
          });
        });
      }
      if (_.isFunction(callback)) { callback(); }
    });
  }
};

module.exports = VcfTabixFormat;

