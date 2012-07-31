<?php
  $genomes = array();
  foreach (glob('*.json') as $filename) {
    $f = file_get_contents($filename);
    $json = json_decode($f);
    $genomes[preg_replace('/\.\\w+$/', '', $filename)] = array(
      'species' => isset($json->species) ? $json->species : NULL, 
      'assemblyDate' => isset($json->assemblyDate) ? $json->assemblyDate : NULL,
      'ver' => crc32($f)
    );
  }
  if (count($genomes)) {
    $default = file_exists('_default.json') ? preg_replace('/\.\\w+$/', '', basename(realpath('_default.json'))) 
      : reset(array_keys($genomes));
    $db = isset($_GET['db']) && isset($genomes[$_GET['db']]) ? $_GET['db'] 
      : (isset($_COOKIE['db']) && $genomes[$_COOKIE['db']] ? $_COOKIE['db'] : $default);
    $ver = isset($genomes[$db]) ? "?v={$genomes[$db]['ver']}" : '';
  } else {
    exit('No genome configurations have been created; please run `rake` or read the README.');
  }
?><!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <meta name="keywords" content="ChromoZoom, genome, genome browser, human genome, yeast genome, html5" />
  <meta name="description" content="ChromoZoom is the most interactive, easy-to-use online genome browser for both curated and custom data." />
  <title>ChromoZoom, the interactive genome browser</title>
  <script src="js/jquery.min.js"></script>
  <script src="js/jquery-ui.min.js"></script>
  <script src="js/jquery.ui.touch-punch.js"></script>
  <script src="js/underscore.min.js"></script>
  <script src="js/jquery.tiptip.js"></script>
  <script src="js/SortedList.js"></script>
  <script src="js/IntervalTree.js"></script>
  <script src="js/CustomTracks.js"></script>
  <script src="js/chromozoom.js"></script>
  <link rel="stylesheet" type="text/css" href="css/syngrey/jquery-ui-1.8.6.custom.css" />
  <link rel="stylesheet" type="text/css" href="css/style.css" />
  <!--[if lte IE 8]><link rel="stylesheet" type="text/css" href="css/iehax.css" /><![endif]-->
</head>
<body>
  
  <div id="wrapper">
    
    <div id="navbar" class="shadow">
      <div id="controls">
        <div class="control-seg">
          <input type="button" id="tracks" name="tracks" value="show tracks&hellip;" />
          <div id="track-picker" class="ui-widget ui-widget-content ui-corner-bottom shadow picker"></div>
        </div>
        <div class="control-seg">
          <input type="button" id="custom-tracks" name="custom-tracks" value="custom tracks&hellip;" />
          <div id="custom-picker" class="ui-widget ui-widget-content ui-corner-bottom shadow picker">
            <div class="form-line"><div class="spinner"></div><strong>add file: </strong><label></label></div>
            <div class="help-line indented">
              Files are read locally, not sent to the server.
            </div>
            <div class="form-line"><div class="spinner"></div><strong>paste: </strong>
              <label>
                <textarea class="paste" name="customPaste" rows="1" cols="30"></textarea>
                <input type="button" name="customPasteAdd" value="add"/>
              </label>
            </div>
            <div class="help-line indented">
              Pasted data are not sent to the server.
            </div>
            <div class="form-line"><div class="spinner"></div><strong>add url: </strong><label></label></div>
            <div class="help-line">
              <a target="_blank" href="http://genome.ucsc.edu/FAQ/FAQformat.html#format1">BED</a>,
              <a target="_blank" href="http://genome.ucsc.edu/goldenPath/help/bedgraph.html">bedGraph</a>,
              <a target="_blank" href="http://genome.ucsc.edu/goldenPath/help/wiggle.html">WIG</a>,
              <a target="_blank" href="http://genome.ucsc.edu/goldenPath/help/bigBed.html">bigBed</a>,
              <a target="_blank" href="http://genome.ucsc.edu/goldenPath/help/bigWig.html">bigWig</a>,
              and <a target="_blank" href="http://genome.ucsc.edu/goldenPath/help/vcf.html">VCFTabix</a><br/>
              are currently supported, using UCSC's specifications.<br/>
              For more details, please see the <a target="_blank" href="docs/#custom-tracks">User Guide.</a>
            </div>
          </div>
        </div>
        <div class="control-seg">       
          <div id="loc-picker" class="ui-widget ui-widget-content ui-corner-bottom shadow"></div>
          <input type="text" id="loc" name="loc" placeholder="location, gene, or keyword"/>
          <input type="button" id="jump" name="jump" value="jump" />
          <label id="zoom-label" for="zoom">zoom:</label>
          <input type="button" id="zoom-out" name="zoom-out" value="-" />
        </div>
        <div class="control-seg">
          <div id="zoom-cont" class="ui-widget ui-widget-content ui-corner-all"><div id="zoom"></div></div>
        </div>
        <div class="control-seg">
          <input type="button" id="zoom-in" name="zoom-in" value="+" />
        </div>
        <div class="control-seg last">
          <div id="line-mode">
            <input type="radio" id="line-mode-multi" name="linemode" value="multi" />
            <label for="line-mode-multi">
              <img src="css/multi-line.png" alt="multi" /><span class="wide"> multi</span>
            </label>
            <input type="radio" id="line-mode-single" name="linemode" checked="checked" value="single" />
            <label id="for-line-mode-single" for="line-mode-single">
              <img src="css/single-line.png" alt="single" /><span class="wide"> single</span>
            </label>
          </div>
          <a href="#" id="linking">
            <img src="css/link.png" alt="link" /><span class="wide"> links</span>
          </a>
          <div id="link-picker" class="ui-widget ui-widget-content ui-corner-bottom shadow picker">
            <div class="form-line">
              <strong>link to this view: </strong><label><input type="url" name="linkhere" class="url" /></label>
            </div>
            <div class="form-line">
              <strong>open region in: </strong><label><a name="ucsc" href="#" target="_blank">the UCSC Genome Browser</a></label>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div id="browser">
      <div id="overlay" class="ui-widget-overlay"></div>
      <div id="overlay-message"></div>
      <div id="fps"></div>
    </div>
    
    <div id="footerbar" class="shadow">
      <div id="logo">
        <p class="slogan">The genome browser that lets you <em>fly</em></p>
      </div>
      <div id="footerlinks">
        <p>
          <a href="#quickstart">Getting started</a> &nbsp;&middot;&nbsp;
          <a href="docs/" target="_blank">User guide</a> &nbsp;&middot;&nbsp;
          <a href="#about">About</a> &nbsp;&middot;&nbsp;
          <a href="http://chromozoom.uservoice.com" id="feedback-link">Feedback</a> &nbsp;&middot;&nbsp;
          <a href="http://github.com/rothlab/chromozoom" target="_blank">Fork me on Github!</a>
        </p>
      </div>
      <div id="genome">
        <input type="button" id="change-genome" name="change-genome" value="&and;" />
        <h1 class="title"></h1>
        <h2 class="description"></h2>
        <div id="genome-picker" class="ui-widget ui-widget-content ui-corner-top shadow picker picker-dark"></div>
      </div>
      <a href="#old-msie" style="display: none"></a>
    </div>
    
    <div id="dialogs">
      
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" tabindex="-1" role="dialog" aria-labelledby="ui-dialog-title-intro-dialog" id="intro-dialog-cont">
        <div id="intro-dialog" class="ui-dialog-content ui-widget-content">
          <h2 id="quickstart">Welcome!  Here's how to get around the genome:</h2>
          <div class="panel-three">
            <div id="intro-panel-1" class="intro-panel"></div>
            <div class="desc"><strong class="num">1.</strong> To <strong>move</strong>,
              drag and throw the track area</div>
          </div>
          <div class="panel-three">
            <div id="intro-panel-2" class="intro-panel"></div>
            <div class="desc"><strong class="num">2.</strong> <strong>Zoom</strong> with mousewheel or two-finger scroll</div>
          </div>
          <div class="panel-three last">
            <div id="intro-panel-3" class="intro-panel"></div>
            <div class="desc"><strong class="num">3.</strong> <strong>Resize</strong> the track label to unpack elements</div>
          </div>
          <p>
            <strong class="num">4.</strong> <strong>Add more tracks</strong> using the
            <button disabled="disabled">show tracks...</button> button 
            in the top left corner.
          </p>
        </div>
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <button type="button" class="ui-state-default ui-corner-all loading">Alright, I got this!</button>
          <a class="tell-me-more" href="docs/" target="_blank">What else can I do?</a>
        </div>
      </div>
      
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" tabindex="-1" role="dialog" aria-labelledby="ui-dialog-title-intro-dialog" id="about-dialog-cont">
        <div id="about-dialog" class="ui-dialog-content ui-widget-content">
          <h2 id="about">About ChromoZoom</h2>
          <p>
            ChromoZoom was written by Theodore Pak with the advice and support of Dr. Frederick "Fritz" Roth in 2012.
          </p>
          <p>
            Takafumi Yamaguchi, Joseph Mellor, and all the members of the <a href="http://llama.mshri.on.ca">Roth Laboratory</a> provided valuable design input and sample custom data.
          </p>
          <p>
            This project would not have been possible without the following open-source programs and libraries:
            <ul>
              <li><a href="http://genome.ucsc.edu">The UCSC Genome Browser</a></li>
              <li><a href="http://www.ruby-lang.org">Ruby</a>, <a href="http://rubygems.org">RubyGems</a>, 
                <a href="http://gembundler.com">Bundler</a>, and <a href="http://rake.rubyforge.org/">Rake</a></li>
              <li><a href="http://fallabs.com/tokyocabinet/">Tokyo Cabinet</a>
                and <a href="http://fallabs.com/tokyotyrant/">Tokyo Tyrant</a></li>
              <li>The <a href="http://nokogiri.org">nokogiri</a>, 
                <a href="http://github.com/jmettraux/rufus-tokyo">rufus-tokyo</a>,
                <a href="http://flori.github.com/json/">json</a>,
                <a href="http://0xcc.net/ruby-bsearch/">bsearch</a>,
                <a href="http://github.com/ffi/ffi/wiki">ffi</a>,
                and <a href="http://htmlentities.rubyforge.org/">htmlentities</a> gems</li>
              <li>The <a href="http://httpd.apache.org/">Apache HTTP Server</a>, 
                <a href="http://php.net">PHP</a>,
                and <a href="http://curl.haxx.se">cURL</a></li>
              <li><a href="http://documentcloud.github.com/underscore/">underscore.js</a>, 
                <a href="http://jquery.com">jQuery</a>,
                and <a href="http://jqueryui.com">jQuery UI</a></li>
              <li>The <a href="http://code.drewwilson.com/entry/tiptip-jquery-plugin">TipTip</a>,
                <a href="http://github.com/kpozin/jquery-nodom">NoDOM</a>,
                <a href="https://github.com/jeresig/jquery.hotkeys">Hotkeys</a>,
                <a href="https://github.com/padolsey/jQuery-Plugins/tree/master/sortElements/">SortElements</a>,
                and <a href="http://github.com/furf/jquery-ui-touch-punch">touch-punch</a> extensions for jQuery</li>
              <li>JavaScript by <a href="http://github.com/shinout">Shin Suzuki</a></li>
              <li><a href="http://www.imagemagick.org">ImageMagick</a>
                and <a href="http://lodev.org/lodepng/">LodePNG</a></li>
            </ul>
          </p>
        </div>
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <button type="button" class="ui-state-default ui-corner-all loading">Close</button>
        </div>
      </div>
      
      <!--[if lte IE 8]>
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" tabindex="-1" role="dialog" aria-labelledby="ui-dialog-title-intro-dialog" id="old-msie-dialog-cont">
        <div id="old-msie-dialog" class="ui-dialog-content ui-widget-content">
          <div id="old-msie-icon"></div>
          <h2 id="old-msie">Old browser alert!</h2>
          <p>
            We've detected you're using an older version of Internet Explorer.
            ChromoZoom runs well only on Internet Explorer <strong>9 or later</strong>.
          </p>
          <p>
            On Windows Vista or 7, you can <a href="http://windows.microsoft.com/en-us/internet-explorer/products/ie/home">
            download it from Microsoft</a> or run Windows Update to upgrade your browser.
          </p>
          <p>
            If you are using an older version of Windows (like XP), we suggest that you check out
            <a href="http://getfirefox.com">Mozilla Firefox</a> or <a href="http://www.google.com/chrome">Google Chrome</a>,
            both of which are free and much faster than Internet Explorer!
          </p>
        </div>
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <button type="button" class="ui-state-default ui-corner-all loading">Proceed anyway</button>
        </div>
      </div>
      <![endif]-->
      
    </div>
    
  </div>
  
  <script type="text/javascript">
    $(function() {
      var genomes = <?php echo json_encode($genomes); ?>;
      $.ajax(<?php echo json_encode("$db.json$ver"); ?>, {
        dataType: 'json',
        success: function(options) { $("#browser").genobrowser($.extend(options, {genomes: genomes})); }
      });
    });
  </script>
  
  <!-- Begin UserVoice widget -->
  <script type="text/javascript">
    var uvOptions = {};
    (function() {
      var uv = document.createElement('script'); uv.type = 'text/javascript'; uv.async = true;
      uv.src = ('https:' == document.location.protocol ? 'https://' : 'http://') + 'widget.uservoice.com/2gpolAZAq2mX9Xg118I0Q.js';
      uv.onload = function() { document.getElementById('feedback-link').href = 'javascript:UserVoice.showPopupWidget()'; };
      var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(uv, s);
    })();
  </script>
  <!-- End UserVoice widget -->
  
</body>
</html>