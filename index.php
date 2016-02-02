<?php
  $REQUIRED_BINARIES = array('tabix', 'bigBedInfo', 'bigBedSummary' ,'bigBedToBed', 'bigWigSummary', 'bigWigInfo');
  include('lib/setup.php');
  $MISSING_BINARIES = find_and_link_binaries($REQUIRED_BINARIES);
    
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
    $db = preg_match('/^\w+$/', $db) && is_readable("$db.json") ? $db : NULL;
    $ver = isset($genomes[$db]) ? "?v={$genomes[$db]['ver']}" : '';
  } else {
    $db = NULL;
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
  <script src="js/RemoteTrack.js"></script>
  <script src="js/IntervalTree.js"></script>
  <script src="js/CustomTracks.js"></script>
  <script src="js/CustomGenomes.js"></script>
  <script src="js/farbtastic.js"></script>
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
            <div class="form-line"><div class="spinner"></div><strong>add URL: </strong><label></label></div>
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
      <a href="#binaries-warning" style="display: none"></a>
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
          <button type="button" class="ui-state-default ui-corner-all loading glowing">Alright, I got this!</button>
          <a class="tell-me-more" href="docs/" target="_blank">What else can I do?</a>
        </div>
      </div>
      
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" tabindex="-1" role="dialog" aria-labelledby="ui-dialog-title-intro-dialog" id="about-dialog-cont">
        <div id="about-dialog" class="ui-dialog-content ui-widget-content">
          <h2 id="about">About ChromoZoom</h2>
          <p>
            ChromoZoom was written by Theodore Pak with the advice and support of Dr. Frederick "Fritz" Roth in 2012.  To cite ChromoZoom, please see our article in <a href="http://bioinformatics.oxfordjournals.org/content/early/2012/12/06/bioinformatics.bts695.short">Bioinformatics</a>.
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
      
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" id="custom-dialog-cont">
        <div id="custom-dialog" class="ui-dialog-content ui-widget-content">
          <h2 class="custom-name"></h2>
          <h3><span class="custom-format"></span> format; <span class="custom-desc"></span> </h3>
          <div class="form-line">
            <label>color:</label>
            <div class="inputs"><input type="text" name="color" value="0,0,0" class="color mono" /></div>
          </div>
          <div class="custom-opts-form bed bigbed">
            <div class="form-line">
              <label>alt color:</label>
              <div class="inputs">
                <input type="checkbox" class="chk enabler" name="colorByStrandOn" value="1" />
                <input type="text" name="colorByStrand" value="0,0,0" class="color mono" />
                <div class="input-note">This color is used for features on the – (minus) strand</div>
              </div>
            </div>
            <div class="form-line">
              <label>shade by score:</label>
              <div class="inputs"><input type="checkbox" class="chk" name="useScore" value="1" /></div>
            </div>
            <div class="form-line">
              <label>color by column 9:</label>
              <div class="inputs"><input type="checkbox" class="chk" name="itemRgb" value="1" /></div>
            </div>
            <div class="form-line">
              <label>item url format:</label>
              <div class="inputs">
                <input type="text" name="url" value="" class="full-length" />
                <div class="input-note">Instances of $$ will be replaced with the feature name</div>
              </div>
            </div>
          </div>
          <div class="custom-opts-form wiggle_0 bigwig bedgraph">
            <div class="form-line">
              <label>alt color:</label>
              <div class="inputs">
                <input type="checkbox" class="chk enabler" name="altColorOn" value="1" />
                <input type="text" name="altColor" value="128,128,128" class="color mono" />
                <div class="input-note">This color is used for values below 0</div>
              </div>
            </div>
            <div class="form-line">
              <label>Y axis range:</label>
              <div class="inputs">
                <input type="checkbox" class="chk enabler" name="autoScale" value="1" />
                <input type="text" name="viewLimitsMin" class="sm" value="0" />
                <div class="range-slider view-limits"></div>
                <input type="text" name="viewLimitsMax" class="sm" value="100" />
              </div>
            </div>
            <div class="form-line">
              <label>Y axis line:</label>
              <div class="inputs">
                <input type="checkbox" class="chk enabler" name="yLineOnOff" value="1" />
                <input type="text" name="yLineMark" class="sm" />
              </div>
            </div>
            <div class="form-line">
              <label>graph type:</label>
              <div class="inputs">
                <select name="graphType"><option>bar</option><option>points</option></select>
              </div>
            </div>
            <div class="form-line">
              <label>windowing func:</label>
              <div class="inputs">
                <select name="windowingFunction">
                  <option>maximum</option><option>mean</option><option>minimum</option>
                </select>
              </div>
            </div>
            <div class="form-line">
              <label>restrict height:</label>
              <div class="inputs">
                <input type="checkbox" class="chk enabler" name="maxHeightPixelsOn" value="1" />
                <input type="text" name="maxHeightPixelsMin" class="sm" value="11" />
                <div class="range-slider max-height-pixels"></div>
                <input type="text" name="maxHeightPixelsMax" class="sm" value="200" />
              </div>
            </div>
          </div>
        </div>
        
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <button type="button" class="ui-state-red delete ui-corner-all left ui-priority-secondary dont-close show" name="delete">Remove this track</button>
          <div class="delete-confirm hidden left">
            <label>Are you sure?
              <button type="button" class="ui-state-red delete ui-corner-all ui-priority-secondary" name="really_delete">Yes, remove it</button>
            </label>
          </div>
          <button type="button" class="ui-state-default ui-corner-all right" name="save">Save</button>
          <button type="button" class="ui-state-default ui-corner-all right ui-priority-secondary">Cancel</button>
        </div>
      </div>
      
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" id="chrom-sizes-dialog-cont">
        <div id="chrom-sizes-dialog" class="ui-dialog-content ui-widget-content">
          <div class="accordion">
            <h3>Load a genome from UCSC</h3>
            <div>
              <div>
                <input type="search" name="filterUcscGenome" value="" class="input-med" placeholder="Filter by keyword" />
              </div>
              <select name="ucscGenome" size="8" class="genome-list loading">
                <option>loading...</option>
              </select>
              <div class="ucsc-options second-col">
                <div class="limit">
                  Load the
                    <select name="limit">
                      <option>50</option>
                      <option selected="selected">100</option>
                      <option>500</option>
                    </select>
                  largest contigs
                </div>
                <div class="ui-state-error ui-corner-all">
                  <span class="ui-icon ui-icon-alert" style="float: left; margin-right: .3em;"></span>
                  <span class="contig-load-error">
                    <strong>Error:</strong> Could not load chrom sizes from UCSC, sorry!
                  </span>
                  <span class="skipped-warning">
                    <strong>Warning:</strong>
                    <span class="skipped-num"></span> contigs were too small to be loaded
                  </span>
                </div>
              </div>
            </div>
            <h3>Load an IGB Quickload directory</h3>
            <div>
              <div class="igb-dirs">
                <select name="igbDirs">
                  <option></option>
                  <option value="">Add a new Quickload URL...</option>
                </select>
              </div>
              <div class="add-igb-dir">
                <label>
                  add URL:
                  <input type="url" name="newIgbDir" class="url" value=""/>
                  <input type="button" name="loadIgbDir" value="Load"/>
                  <input type="button" name="cancelLoadIgbDir" value="Cancel"/>
                </label>
              </div>
              <div>
                <input type="search" name="filterIgbGenome" value="" class="input-med" placeholder="Filter by keyword" />
              </div>
              <select name="igbGenome" size="7" class="genome-list loading">
                <option>loading...</option>
              </select>
              <div class="igb-options second-col">
                <div class="limit">
                  Load the
                    <select name="igblimit">
                      <option>50</option>
                      <option selected="selected">100</option>
                      <option>500</option>
                    </select>
                  largest contigs
                </div>
                <div class="ui-state-error ui-corner-all">
                  <span class="ui-icon ui-icon-alert" style="float: left; margin-right: .3em;"></span>
                  <span class="contig-load-error">
                    <strong>Error:</strong> Could not load this genome, sorry!
                  </span>
                  <span class="skipped-warning">
                    <strong>Warning:</strong>
                    <span class="skipped-num"></span> contigs were too small to be loaded
                  </span>
                </div>
              </div>
            </div>
            <h3>Or, enter chromosome names and sizes</h3>
            <div>
              <p>One chromosome per line, followed by whitespace, then the size in bp.</p>
              <textarea class="placeholder" name="chromsizes" rows="7" cols="80">chr1 1000000
chr2 350000
chr3 2000000</textarea>
              <label>genome name (optional):</label>
              <input type="text" name="name" value="custom" class="full-length" />
            </div>
          </div>
        </div>
        
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <div class="left contigs-loading"><img src="css/loading-sm.gif" alt="loading"/> Loading contigs&hellip;</div>
          <button type="button" class="ui-state-default ui-corner-all right" name="save">Set chromosomes</button>
          <button type="button" class="ui-state-default ui-corner-all right ui-priority-secondary">Cancel</button>
        </div>
      </div>

      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" id="custom-genome-dialog-cont">
        <div id="custom-genome-dialog" class="ui-dialog-content ui-widget-content">
          <div class="help-line">
            <!--<a target="_blank" href="ftp://ftp.ebi.ac.uk/pub/databases/embl/doc/usrman.txt">EMBL</a>,
            <a target="_blank" href="http://www.ncbi.nlm.nih.gov/Sitemap/samplerecord.html">GenBank</a>,
            and <a target="_blank" href="http://en.wikipedia.org/wiki/FASTA_format">FASTA</a>
            are currently supported.<br/>
            For more details, please see the <a target="_blank" href="docs/#custom-genomes">User Guide.</a>-->
            <a target="_blank" href="http://www.ncbi.nlm.nih.gov/Sitemap/samplerecord.html">GenBank</a> and
            <a target="_blank" href="http://en.wikipedia.org/wiki/FASTA_format">FASTA</a>
            files are supported; EMBL is coming soon.
          </div>
          <div class="form-line">
            <div class="spinner"></div><strong>load file: </strong><label></label>
            <div class="help-line indented">
              Files are read locally, not sent to the server.
            </div>
          </div>
          <div class="form-line"><div class="spinner"></div><strong>paste:</strong>
            <label>
              <textarea class="paste" name="customGenomePaste" rows="3" cols="30"></textarea>
              <input type="button" name="customGenomePasteAdd" value="Load"/>
            </label>
            <div class="help-line indented">
              Pasted data are not sent to the server.
            </div>
          </div>
          <div class="form-line">
            <div class="spinner"></div><strong>load URL: </strong><label></label>
          </div>
        </div>
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <button type="button" class="ui-state-default ui-corner-all right ui-priority-secondary">Cancel</button>
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
      <?php if (count($MISSING_BINARIES) > 0): ?>
      <div class="ui-dialog ui-widget ui-widget-content ui-corner-all big-shadow" tabindex="-1" role="dialog" id="binaries-warning-dialog-cont">
        <div id="binaries-warning-dialog" class="ui-dialog-content ui-widget-content">
          <h2 id="binaries-warning">Installing extra binaries</h2>
          <p>
            In order for certain features of custom tracks to work, you will need to install the following
            binaries on PATH for the account that your webserver runs under:
          </p>
          <ul>
            <?php foreach ($MISSING_BINARIES as $bin): ?>
            <li><?php echo $bin; ?></li>
            <?php endforeach; ?>
          </ul>
          <p>Visit the <a href="http://www.htslib.org/download/">HTSLib</a>
            and <a href="http://hgdownload.cse.ucsc.edu/admin/exe/">Jim Kent big* tools</a> sites 
            for download links and installation instructions.
          </p>
        </div>
        <div class="ui-dialog-buttonpane ui-widget-content ui-helper-clearfix">
          <button type="button" class="ui-state-default ui-corner-all loading">Proceed anyway</button>
        </div>
      </div>
      <?php endif; ?>
      
    </div>
    
  </div>
  
  <script type="text/javascript">
    $(function() {
      var genomes = <?php echo json_encode($genomes); ?>;
    <?php if ($db === NULL): ?>
      var options = CustomGenomes.blank().options({width: window.innerWidth});
    <?php else: ?>
      var options = <?php echo file_get_contents("$db.json"); ?>;
    <?php endif; ?>
      $("#browser").genobrowser($.extend(options, {genomes: genomes}));
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
  
  <!-- Begin Google Analytics -->
  <script type="text/javascript">

    var _gaq = _gaq || [];
    _gaq.push(['_setAccount', 'UA-33827672-1']);
    _gaq.push(['_trackPageview']);

    (function() {
      var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
      ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
      var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
    })();

  </script>
  <!-- End Google Analytics -->
  
</body>
</html>