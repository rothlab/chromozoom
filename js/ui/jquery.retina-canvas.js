/*
 * This module enhances the HTMLCanvasElement to permit easier usage on Retina screens.
 *
 * It is similar to the approach used in https://github.com/jondavidjohn/hidpi-canvas-polyfill
 * except please note that webkitBackingStorePixelRatio is now deprecated in Safari:
 * https://developer.apple.com/library/content/releasenotes/General/WhatsNewInSafari/Articles/Safari_7_0.html#//apple_ref/doc/uid/TP40014305-CH5-SW18
 * and therefore we should mostly be looking at window.devicePixelRatio as to what our true ratio
 * between CSS pixels and device pixels is.
 *
 * In general, we want to operate in CSS pixels since that's the unit used by other code in chromozoom.
 * 
 * Here we provide a helper to calculate and cache the CSS to device pixel ratio on the <canvas> element,
 * setters and getters for the canvas height and width that use CSS pixels instead of canvas pixels,
 * and a wrapped .getContext('2d') method that automatically .scale()'s the context if the pixel ratio > 1.
 * We also add a $.fn.canvasAttr() jQuery method that simplifies access to height/width from jQuery.
 */

module.exports = function(global, jQuery) {

  (function(prototype, $) {
  
    var _superGetContext = prototype.getContext;
  
    // A helper to calculate and cache the CSS to device pixel ratio for the <canvas> element
    // This is calculated only once, even if the <canvas> is moved to a different display.
    prototype.calculateRatio = function(context) {
      var ratio = $(this).data('ratio'),
        backingStore, context;
    
      if (ratio) { return ratio; }
      context = context || _superGetContext.call(this, '2d');
    
      backingStore = context.backingStorePixelRatio ||
            context.webkitBackingStorePixelRatio ||
            context.mozBackingStorePixelRatio ||
            context.msBackingStorePixelRatio ||
            context.oBackingStorePixelRatio || 1;
    
      ratio = (global.devicePixelRatio || 1) / backingStore;
      $(this).data('ratio', ratio);
      return ratio;
    };
  
    // Sets or returns the height of the canvas in CSS pixels.
    prototype.unscaledHeight = function(height) {
      var ratio = this.calculateRatio();
      if (typeof(height) == 'undefined') { return this.height / ratio; }
      else {
        // anytime you change canvas dimensions, the drawing context resets
        $(this).data('currentScale', 1);
        this.height = height * ratio;
        return height;
      }
    };
    
    // Sets or returns the width of the canvas in CSS pixels.
    prototype.unscaledWidth = function(width) {
      var ratio = this.calculateRatio();
      if (typeof(width) == 'undefined') { return this.width / ratio; }
      else {
        // anytime you change canvas dimensions, the drawing context resets
        $(this).data('currentScale', 1);
        this.width = width * ratio;
        return width;
      }
    };
  
    // A wrapper for the native method that automatically .scale()'s the context if the pixel ratio > 1.
    prototype.getContext = function(type) {
      var backingStore, ratio, currentScale,
        context = _superGetContext.call(this, type),
        currentScale = $(this).data('currentScale') || 1;

      if (type === '2d') {
        ratio = this.calculateRatio(context);

        if (ratio / currentScale > 1) { 
          context.scale(ratio / currentScale, ratio / currentScale);
          $(this).data('currentScale', ratio);
        }
      }

      return context;
    };
  
  })(global.HTMLCanvasElement.prototype, jQuery);
  
  
  
  (function($) {
    
    // Shim for setters where it will pass height and width to unscaledHeight and unscaledWidth above.
    //
    // We create a new function instead of shimming $.fn.attr to avoid a massive performance penalty, 
    // as $.fn.attr is used all over jQuery code and it is rarely interacting with <canvas> elements
    
    $.fn.canvasAttr = function(attrs, val) {
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