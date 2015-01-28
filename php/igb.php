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
      $response['db'] = "igb:$url";
      $response['limit'] = $contig_limit;
      $response['skipped'] = $top_chroms['skipped'];
      $response['mem'] = memory_get_usage();
      $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $top_chroms['rows']));
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
