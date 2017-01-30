module.exports = function(global, jQuery) {

  (function(prototype) {
  
    var _superGetContext = prototype.getContext;
  
    prototype.calculateRatio = function(context) {
      var backingStore;
      context = context || _superGetContext.call(this, '2d');
    
      if (context.ratio) { return context.ratio; }
    
      backingStore = context.backingStorePixelRatio ||
            context.webkitBackingStorePixelRatio ||
            context.mozBackingStorePixelRatio ||
            context.msBackingStorePixelRatio ||
            context.oBackingStorePixelRatio || 1;
    
      context.ratio = (global.devicePixelRatio || 1) / backingStore;
      return context.ratio;
    };
  
    prototype.unscaledHeight = function(height) {
      var ratio = this.calculateRatio();
      if (typeof(height) == 'undefined') { return this.height / ratio; }
      else {
        this.height = height * ratio;
        return height;
      }
    };
  
    prototype.unscaledWidth = function(width) {
      var ratio = this.calculateRatio();
      if (typeof(width) == 'undefined') { return this.width / ratio; }
      else {
        this.width = width * ratio;
        return width;
      }
    };
  
    prototype.getContext = function(type) {
      var backingStore, ratio, currentScale,
        context = _superGetContext.call(this, type);

      if (type === '2d') {
        ratio = this.calculateRatio(context);
      
        currentScale = context.currentScale || 1;

        //if (ratio / currentScale > 1) { 
        //  context.currentScale = ratio;
        context.scale(ratio, ratio);
      }

      return context;
    };
    
    prototype.scaleByRatio = function() {
      
    }
  
  })(global.HTMLCanvasElement.prototype);
  
  
  
  (function($) {
    
    // Shim for setters where it will pass height and width to unscaledHeight and unscaledWidth above.
    //
    // We create a new function instead of shimming $.fn.attr to avoid a massive performance penalty, 
    // as $.fn.attr is used everywhere in jQuery code and usually not on <canvas> elements
    
    jQuery.fn.canvasAttr = function(attrs, val) {
      var name = attrs,
        elem;
      
      if (typeof val != 'undefined') {
        attrs = {};
        attrs[name] = val;
      }
      
      if (typeof attrs != 'object') {
        elem = this.get(0);
        if (elem.tagName === 'CANVAS') {
          if (name == 'height') { return elem.unscaledHeight(); }
          else if (name == 'width') { return elem.unscaledWidth(); }
          else return this.attr(name, val);
        } else { throw "You should only use $.fn.canvasAttr on <canvas> elements." }
      }
      
      this.each(function() {
        elem = this;
        if (elem.tagName === 'CANVAS') {
          jQuery.each(attrs, function(k, v) {
            if (k == 'height') { elem.unscaledHeight(v); }
            else if (k == 'width') { elem.unscaledWidth(v); }
            else { $(elem).attr(k, v); }
          });
        } else { throw "You should only use $.fn.canvasAttr on <canvas> elements." }
      });
      
      // allow chaining when used as a setter
      return this;
    }
    
  })(jQuery);
  
};