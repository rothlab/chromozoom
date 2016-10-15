// ====================================================================
// = chrom.sizes format: http://www.broadinstitute.org/igv/chromSizes =
// ====================================================================
// Note: we are extending the general use of this to include data loaded from the genome.txt and annots.xml
// files of an IGB quickload directory,

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  optsAsTrackLine = utils.optsAsTrackLine
  trackHeightForType = utils.trackHeightForType;

var ChromSizesFormat = {
  init: function() {
    var self = this,
      m = self.metadata,
      o = self.opts;
    o.species = m.species || 'Custom Genome';
    o.assemblyDate = m.assemblyDate || '';
    
    if (m.tracks) { self.format().createTracks(m.tracks); }
    o.searchableTracks = m.moreTracks || (m.tracks && m.tracks.length > 15);
    self.canSearchTracks = _.isString(m.moreTracks);
    
    if (m.cytoBandIdeo) { self.format().createChrBands(m.cytoBandIdeo); }
  },
  
  createTracks: function(tracks) {
    var self = this,
      o = self.opts,
      categories = {};
      
    _.each(tracks, function(t) {
      var trackOpts, 
        visible = true,
        cat = t.grp || "Feature Tracks",
        container, trackSpec, tagging;
      
      t.lines = t.lines || [];
      trackOpts = /^track\s+/i.test(t.lines[0]) ? global.CustomTracks.parseDeclarationLine(t.lines.shift()) : {};
      _.extend(trackOpts, t.opts, {name: t.name, type: t.type});
      if (t.parent || trackOpts.visibility == 'hide') { visible = false; }
      delete trackOpts.visibility;
      
      if (t.composite) {
        
        container = trackOpts.container && trackOpts.container == 'multiWig' ? 'multiWig' : 'composite';
        tagging = trackOpts.tagging;
        delete trackOpts.container;
        delete trackOpts.tagging;
        
        trackSpec = {
          n: t.name,
          c: container,
          opts: trackOpts,
          tagging: tagging
        };
        o.compositeTracks.push(trackSpec);
    
      } else {
        trackSpec = {
          fh: {},
          n: t.name,
          s: ['dense', 'squish', 'pack'],
          h: trackHeightForType(t.type),
          m: ['pack'],
          customData: t.lines
        };
        
        if (t.parent) { trackSpec.parent = t.parent; }
        if (trackOpts.tags) { trackSpec.tags = trackOpts.tags; }
        delete trackOpts.tags;
        
        t.lines.unshift('track ' + optsAsTrackLine(trackOpts) + '\n');
        o.availTracks.push(trackSpec);
        if (visible) { o.tracks.push({n: t.name}); }
      }
      
      o.trackDesc[t.name] = {
        cat: cat,
        sm: t.shortLabel || t.name,
        lg: t.description || t.name
      };
      
      categories[cat] = true;
    });
    
    if (_.keys(categories).length > 1) { o.groupTracksByCategory = true; }
  },
  
  createChrBands: function(cytoBandIdeo) {
    var o = this.opts;
    o.chrBands = _.compact(_.map(cytoBandIdeo.split("\n"), function(l) { 
      var fields = l.split("\t");
      if (fields.length != 5) { return false; }
      fields[1] = parseInt10(fields[1]);
      fields[2] = parseInt10(fields[2]);
      return fields;
    }));
    if (o.chrBands.length > 0) { 
      o.ideogramsAbove = true;
      o.availTracks[0].h = 50;
    }
  },
  
  parse: function(text) {
    var lines = text.split("\n"),
      o = this.opts;
    
    _.each(lines, function(line, i) {
      var chrsize = strip(line).split(/\s+/, 2),
        chr = chrsize[0],
        size = parseInt10(chrsize[1]);
      if (_.isNaN(size)) { return; }
      o.chrOrder.push(chr);
      o.chrLengths[chr] = size;
      o.genomeSize += size;
    });
    
    if (o.chrBands && o.chrBands.length > 0) {
      o.chrBands = _.filter(o.chrBands, function(v) { return !_.isUndefined(o.chrLengths[v[0]]); });
    }
  },
  
  searchTracks: function(query, callback) {
    var self = this,
      o = self.opts;
    if (!_.isString(o.searchableTracks)) { callback([]); }
    
    $.ajax(self.ajaxDir() + o.searchableTracks, {
      data: {url: self.opts.bigDataUrl, search: query},
      success: function(data) {
      }
    });
  }
  
};

module.exports = ChromSizesFormat;