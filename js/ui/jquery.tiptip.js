 /*
 * TipTip
 * Copyright 2010 Drew Wilson
 * www.drewwilson.com
 * code.drewwilson.com/entry/tiptip-jquery-plugin
 *
 * Modified by Theodore Pak for inclusion with ChromoZoom. Most of the positioning
 * and content loading code was completely replaced.
 *
 * Original description: This Plugin will create a custom tooltip to replace 
 * the default browser tooltip. It is lightweight and smart in
 * that it detects the edges of the browser window and will make sure
 * the tooltip stays within the current window size. As a result the
 * tooltip will adjust itself to be displayed above, below, to the left 
 * or to the right depending on what is necessary to stay within the
 * browser window. It is completely customizable as well via CSS.
 *
 * This TipTip jQuery plug-in is dual licensed under the MIT and GPL licenses:
 *   http://www.opensource.org/licenses/mit-license.php
 *   http://www.gnu.org/licenses/gpl.html
 */

var _ = require('../underscore.min.js');

module.exports = function($){
    
  var defaults = { 
    activation: "hover",
    keepAlive: false,
    edgeOffset: 3,
    defaultPosition: "bottom",
    delay: 400,
    fadeIn: 200,
    fadeOut: 200,
    attribute: "title",
    content: false,        // HTML or String to fill TipTIp with
    enter: function(){},
    async: false,
    startActivated: false,
    allowOverlayX: false,  // allow the tipTip to overlay the element along the X-axis 
  };
  var $tiptip_holder, $tiptip_content, $tiptip_arrow, activating_elem;
  
  function show_tiptip(opts) { 
    $tiptip_holder.stop(true, true).fadeIn(opts.fadeIn);
    if (opts.async && !$(this).data('tiptipActive')) { return; }
    
  };
  
  function fill_show_tiptip(d, self, content) {
    var opts = d.opts,
      $org_elem = d.org_elem,
      overlayX = opts.allowOverlayX && typeof d.pageX == 'number',
      org_title = content ? content : d.org_title,
      timeout = $(self).data('tiptipTimeout'),
      active = $(self).data('tiptipActive'),
      firedAfter = (new Date).getTime() - active;
    
    if (opts.async) {
      if (!active) { return; }
      if (content === false) { $(this).data('tiptipActive', false); return; }
    }
    
    if (_.isString(org_title)) { $tiptip_content.html(org_title); }
    else { $tiptip_content.empty().append(org_title); }
    $tiptip_holder.removeAttr("class").css("margin", 0);
    $tiptip_arrow.removeAttr("style");

    var offset = $org_elem.offset(),
      top = offset.top,
      left = overlayX ? d.pageX - 5 : offset.left,
      scroll_top = $(window).scrollTop(),
      scroll_left = $(window).scrollLeft(),
      win_width = $(window).width(),
      win_height = $(window).height(),
      org_width = overlayX ? 10 : $org_elem.outerWidth(),
      org_height = $org_elem.outerHeight();

    if (left - scroll_left >= 0) { org_width = Math.min(org_width, win_width - (left - scroll_left)); }
    else { org_width += (left - scroll_left); left = scroll_left; }
    
    var tip_w = $tiptip_holder.outerWidth(),
      tip_h = $tiptip_holder.outerHeight(),
      w_compare = Math.round((org_width - tip_w) / 2),
      h_compare = Math.round((org_height - tip_h) / 2),
      marg_left = Math.round(left + w_compare),
      marg_top = Math.round(top + org_height + opts.edgeOffset),
      t_class = "",
      arrow_top = "",
      arrow_left = Math.round(tip_w - 12) / 2,
      top_or_bottom_default;

    t_class = "_" + opts.defaultPosition;
    top_or_bottom_default = opts.defaultPosition == 'bottom' || opts.defaultPosition == 'top';

      // While centered horizontally, would the left edge of the tipTip clip outside the viewport?
    var left_clips = (w_compare + left) < scroll_left,
      // While centered horizontally, would the right edge of the tipTip clip outside the viewport?
      right_clips = (tip_w + left) > win_width,
      // While centered vertically, would the top or bottom edge of the tipTip clip outside the viewport?
      vcentered_would_clip = (top + org_height/2 + h_compare < scroll_top) 
          || (top + org_height/2 - h_compare > win_height + scroll_top),
      // In the bottom position, would the bottom edge of the tipTip clip outside the viewport?
      bottom_would_clip = (top + org_height + opts.edgeOffset + tip_h + 8) > win_height + scroll_top, 
      // In the top position, would the top edge of the tipTip clip outside the viewport?
      top_would_clip = (top - (opts.edgeOffset + tip_h + 8)) < scroll_top;

    // If by default, the tipTip is on top or bottom but it would clip in either direction, we have to switch to left/right
    if ((t_class == "_top" || t_class == "_bottom") && bottom_would_clip && top_would_clip) { 
      t_class = "_left";
      top_or_bottom_default = false;
    }

    // Orient the tipTip to the left/right if it is preferable to centered
    if ((left_clips && w_compare < 0) || (t_class == "_right" && !right_clips) 
        || (t_class == "_left" && left < (tip_w + opts.edgeOffset + 5))) {
      t_class = "_right";
      arrow_top = Math.round(tip_h - 13) / 2;
      arrow_left = -12;
      marg_left = Math.round(left + org_width + opts.edgeOffset);
      marg_top = Math.round(top + h_compare);
    } else if ((right_clips && w_compare < 0) || (t_class == "_left" && !left_clips)) {
      t_class = "_left";
      arrow_top = Math.round(tip_h - 13) / 2;
      arrow_left =  Math.round(tip_w);
      marg_left = Math.round(left - (tip_w + opts.edgeOffset + 5));
      marg_top = Math.round(top + h_compare);
    }

    // Now, orient the tipTop to the top or bottom if it is better than centered
    if (!top_would_clip && ((top_or_bottom_default && bottom_would_clip) || vcentered_would_clip)) {
      t_class = (t_class == "_left" || t_class == "_right") ? t_class + "_top" : "_top";
    } else if (!bottom_would_clip && ((top_or_bottom_default && top_would_clip) || vcentered_would_clip)) {
      t_class = (t_class == "_left" || t_class == "_right") ? t_class + "_bottom" : "_bottom";
    }
    if (t_class.indexOf("_top") != -1) {
      arrow_top = tip_h;
      marg_top = Math.round(top - (tip_h + 5 + opts.edgeOffset));
    } else if (t_class.indexOf("_bottom") != -1) {
      arrow_top = -12;
      marg_top = Math.round(top + org_height + opts.edgeOffset);
    }

    if (t_class == "_right_top" || t_class == "_left_top") {
      marg_top = marg_top + 5;
    } else if (t_class == "_right_bottom" || t_class == "_left_bottom") {   
      marg_top = marg_top - 5;
    }
    if (t_class == "_left_top" || t_class == "_left_bottom") {  
      marg_left = marg_left + 5;
    }
    $tiptip_arrow.css({"margin-left": arrow_left+"px", "margin-top": arrow_top+"px"});
    $tiptip_holder.css({"margin-left": marg_left+"px", "margin-top": marg_top+"px"}).attr("class", "tip"+t_class);

    if (timeout) { clearTimeout(timeout); }
    if (firedAfter > opts.delay) { show_tiptip(opts); } 
    else { $(self).data('tiptipTimeout', setTimeout(_.bind(show_tiptip, self, opts), opts.delay - firedAfter)); }
  }

  function active_tiptip (e) {
    var self = this,
      d = e.data,
      content;
    $.extend(d, {pageX: e.pageX, pageY: e.pageY});
    $(this).data('tiptipActive', (new Date).getTime());
    if (activating_elem && activating_elem != self) { $.tipTip.hide(); }
    activating_elem = self;
    if (d.opts.async) { d.opts.enter.call(this, function(newContent) { fill_show_tiptip(d, self, newContent); }); }
    else {
      content = d.opts.enter.call(this);
      fill_show_tiptip(d, this, content); 
    }
    return d.retFalse ? false : null;
  }
  
  function deactive_tiptip(e, now) {
    var d = e.data,
      timeout = $(this).data('tiptipTimeout');
    $(this).data('tiptipActive', false);
    if (timeout){ clearTimeout(timeout); }
    activating_elem = null;
    $tiptip_holder.fadeOut(now ? d.opts.fadeOut : 0);
  }
  
  $.tipTip = {
    hide: function() {
      var $active = $(activating_elem);
      if ($active.parent().length > 0) { $active.trigger('hideTipTip'); } 
      else { $tiptip_holder && $tiptip_holder.hide(); }
      activating_elem = null;
    }
  };
  
  $.fn.tipTip = function(options) {
    var opts = $.extend({}, defaults, options);
    
    // Setup tip tip elements and render them to the DOM, if this wasn't already done previously
    if(typeof $tiptip_holder == 'undefined'){
      $tiptip_holder = $('<div id="tiptip_holder"></div>');
      $tiptip_content = $('<div id="tiptip_content"></div>');
      $tiptip_arrow = $('<div id="tiptip_arrow"></div>');
      $("body").append($tiptip_holder.html($tiptip_content).prepend($tiptip_arrow.html('<div id="tiptip_arrow_inner"></div>')));
    }
    
    return this.each(function(){
      var $org_elem = $(this);
      
      if (opts.content) {
        var org_title = opts.content;
      } else {
        var org_title = $org_elem.attr(opts.attribute);
      }
      
      if (org_title != "" || opts.async) {
        $org_elem.data('title', org_title);
        $org_elem.removeAttr(opts.attribute); //remove original Attribute
        var edata = {org_elem: $org_elem, org_title: org_title, opts: opts};
        
        if (opts.activation == "hover") {
          $org_elem.bind('mouseenter showTipTip', edata, active_tiptip);
          if (opts.keepAlive) { $tiptip_holder.bind('mouseleave hideTipTip', edata, deactive_tiptip); }
          else { $org_elem.bind('mouseleave hideTipTip', edata, deactive_tiptip); }
        } else if (opts.activation == "focus") {
          $org_elem.bind('focus showTipTip', edata, active_tiptip).bind('blur hideTipTip', edata, deactive_tiptip);
        } else if (opts.activation == "click") {
          $org_elem.bind('click showTipTip', $.extend({retFalse: true}, edata), active_tiptip);
          if(opts.keepAlive){ $tiptip_holder.bind('mouseleave hideTipTip', edata, deactive_tiptip); } 
          else { $org_elem.bind('mouseleave hideTipTip', edata, deactive_tiptip); }
        }
        if (opts.startActivated) { $org_elem.trigger('showTipTip'); }
      }
    });
  }
};