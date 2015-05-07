<?php
/**
 * This page retrieves genome info for a IGB Quickload directory
 * or one of the genomes contained therein.
 * This format is documented at: https://wiki.transvar.org/confluence/display/igbman/Creating+QuickLoad+Sites
 * An example of a directory is: http://igbquickload.org/quickload/
 **/

header("Content-type: application/json");
// header("Cache-control: max-age=172800, public, must-revalidate");
// header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800)); // Have this page expire within 48 hours.

require_once("../lib/spyc.php");
require_once("../lib/setup.php");
require_once("../lib/chromsizes.php");

function forbidden($err) {
  header('HTTP/1.1 403 Forbidden'); 
  if (strlen($err)) { echo json_encode(array('error'=>$err)); } 
  exit;
}

$response = array();

$ucsc_config = Spyc::YAMLLoad(where_is_ucsc_yaml());

$default_igb_dirs = array('http://igbquickload.org/quickload');
$default_igb_dirs = isset($ucsc_config['igb_dirs']) ? $ucsc_config['igb_dirs'] : $default_igb_dirs;
$looks_roman = FALSE;

function hex2rgb($color) {
  return implode(',', array_map('hexdec', str_split($color, 2)));
}

function urlExists($url) {
  $file_headers = @get_headers($url);
  if (!$file_headers || !is_array($file_headers)) { return false; }
  // get_headers() will follow redirects and return all lines.
  // We want to search for an HTTP 20x response in a Status-Line of the headers
  foreach ($file_headers as $header) {
    if (preg_match('#HTTP/\\d\\.\\d +2\\d\\d +#', trim($header))) { return true; }
  }
  return false;
}

function checkURLType($url) {
  if (urlExists("$url/genome.txt")) { return 'genome'; }
  if (urlExists("$url/contents.txt")) { return 'dir'; }
}

// resolves a relative URL to an absolute one given a base URL
// from http://stackoverflow.com/questions/4444475/transfrom-relative-path-into-absolute-url-using-php
function rel2abs($rel, $base) {
  if (parse_url($rel, PHP_URL_SCHEME) != '') return $rel;
  if ($rel[0]=='#' || $rel[0]=='?') return $base.$rel;

  extract(parse_url($base));

  $path = preg_replace('#/[^/]*$#', '', $path);
  if ($rel[0] == '/') $path = '';
  
  $abs = "$host$path/$rel";
  /* replace '//' or '/./' or '/foo/../' with '/' */
  $re = array('#(/\.?/)#', '#/(?!\.\.)[^/]+/\.\./#');
  for($n=1; $n>0; $abs=preg_replace($re, '/', $abs, -1, $n)) {}

  return $scheme.'://'.$abs;
}

function getQuickloadDirContents($url, &$response) {
  $contents = file_get_contents("$url/contents.txt");
  $response[$url] = array();
  foreach(explode("\n", $contents) as $line) {
    $fields = array_slice(explode("\t", $line), 0, 2);
    if (trim($fields[0]) == '') { continue; }
    $fields[1] = isset($fields[1]) && trim($fields[1]) != '' ? trim($fields[1]) : $fields[0];
    $response[$url][$fields[0]] = $fields[1];
  }
}

# IGB requires certain file extensions for various formats, which makes our job easier.
# See https://wiki.transvar.org/display/igbman/File+Formats
function guessTrackFormat($url) {
  $path = parse_url($url, PHP_URL_PATH);
  $file_name = basename($path);
  $format = NULL;
  $extension_matchers = array(       # Searched in this order, first match wins.
    '#\\.vcf(\\.\\w+)*\\.b?gz$#' => "vcftabix",
    '#\\.bed\\.b?gz$#' => "bedgz",     # not yet implemented.
    '#\\.bedgraph$#' => "bedgraph",
    '#\\.(bigbed|bb)$#' => "bigbed",
    '#\\.(bigwig|bw)$#' => "bigwig",
    '#\\.wig$#' => "wiggle_0",
    '#\\.sam$#' => "sam",            # not yet implemented.
    '#\\.bam$#' => "bam",            # not yet implemented.
    '#\\.(gff|gtf|gff3)$#' => "gff", # not yet implemented.
    '#\\.(bed|txt)$#' => "bed"
  );
  foreach($extension_matchers as $matcher => $possible_format) {
    if (preg_match($matcher, $file_name)) { $format = $possible_format; break; }
  }
  return $format;
}

function getAnnotsAsTracks($url) {
  $tracks = array();
  if (!urlExists($url)) { return $tracks; }
  try { 
    @$files = new SimpleXMLElement(file_get_contents($url));
  } catch (Exception $e) { return $tracks; }
  if (!$files) { return $tracks; }
  foreach ($files->file as $file) {
    $track_url = rel2abs((string) $file['name'], $url);
    $track = array(
      "name" => (string) ($file['title'] ? $file['title'] : $file['name']),
      "description" => (string) $file['description'],
      "opts" => array()
    );
    if ($file['url']) {
      $track['url'] = rel2abs((string) $file['url'], $url);
    }
    $format = guessTrackFormat($track_url);
    if ($format === NULL) { continue; }
    $track['type'] = $format;
    
    $force_inline = (string) $file['load_hint'] == 'Whole Sequence'; // We could use this as an option to forcibly inline track data
    if (in_array($format, array('bed', 'bedgraph', 'wig'))) {
      $track['lines'] = explode("\n", file_get_contents($track_url));
    } else {
      $track['opts']['bigDataUrl'] = $track_url;
    }
    
    // Map certain annots.xml options that can override certain track definition options. Compare the following:
    // https://wiki.transvar.org/display/igbman/Creating+QuickLoad+Sites#CreatingQuickLoadSites-Annots.xmloptions-specifytrackcolor,annotationstyle,andmore
    // https://genome.ucsc.edu/goldenPath/help/customTrack.html#TRACK
    if ((string) $file['foreground']) { $track['opts']['color'] = hex2rgb((string) $file['foreground']); }
    if ((string) $file['max_depth']) { $track['opts']['maxItems'] = (string) $file['max_depth']; }
    if (in_array((string) $file['direction_type'], array('color', 'both'))) {
      if ((string) $file['positive_strand_color'] && (string) $file['negative_strand_color']) {
        $track['opts']['colorByStrand'] = hex2rgb((string) $file['positive_strand_color']) . ' ' 
          . hex2rgb((string) $file['negative_strand_color']);
      }
    }

    array_push($tracks, $track);
  }
  return $tracks;
}

if (isset($_GET['url'])) {
  if (!preg_match('#^(https?|ftp)://#', $_GET['url'])) { forbidden(); }
  $url = preg_replace('#/$#', '', $_GET['url']); // remove trailing slash
  $url_type = checkURLType($url);
  
  if ($url_type == 'genome') {
    $contig_limit = isset($_GET['limit']) ? min(max(intval($_GET['limit']), 50), 500) : 100;
    
    $top_chroms = getTopChromSizes("$url/genome.txt", $contig_limit);
  
    if ($top_chroms === FALSE) { 
      $response['error'] = TRUE;
    } else {
      $response['db'] = $url;
      $response['limit'] = $contig_limit;
      $response['skipped'] = $top_chroms['skipped'];
      $response['mem'] = memory_get_usage();
      $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $top_chroms['rows']));
      
      // TODO: $response['species'], $response['assemblyDate']
      // TODO: Get stuff from annots.xml into $response somehow
      $response['tracks'] = getAnnotsAsTracks("$url/annots.xml");
      
    }
  } elseif ($url_type == 'dir') {
    // this is a Quickload dir, with a contents.txt
    // parse it and return the genome directories and descriptions
    getQuickloadDirContents($url, $response);
  } else {
    forbidden();
  }
} else {
  // We don't know what we want.
  // Get contents.txt for all of the default IGB dirs;
  // parse them and return the genome directories and descriptions
  foreach ($default_igb_dirs as $igb_dir) {
    getQuickloadDirContents(preg_replace('#/$#', '', $igb_dir), $response);
  }
}

echo json_encode($response);
