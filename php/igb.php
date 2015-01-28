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
require_once("../lib/chrsort.php");

function forbidden($err) { 
  header('HTTP/1.1 403 Forbidden'); 
  if (strlen($err)) { echo json_encode(array('error'=>$err)); } 
  exit;
}

$response = array();

$ucsc_config = Spyc::YAMLLoad(where_is_ucsc_yaml());

$default_igb_dirs = array('http://igbquickload.org/quickload/');
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

if (isset($_GET['url'])) {
  if (!preg_match('#^(https?|ftp)://#', $_GET['url'])) { forbidden(); }
  $url = preg_replace('#/$#', '', $_GET['url']); // remove trailing slash
  $url_type = checkURLType($url);
  
  if ($url_type == 'genome') {
    $chrom_sizes = array();
    $rows = array();
    $important_chroms = array();
    
    $fp = fopen($_GET['url'] . "/genome.txt");
    $last_line = "";
    while (!feof($fp)) {
      $chunk = $last_line . fread($fp, 1048576); // want to read 1MB at a time
      $lines = explode("\n", $chunk);
      foreach($lines as $i => $line) {
        if ($i == count($lines) - 1) { $last_line = $line; continue; }
        else {
          $chr = processLine($line, $chrom_sizes);
          if ($chr !== FALSE) { $important_chroms[$chr] = TRUE; }
        }
      }
    }
    $chr = processLine($line, $chrom_sizes);
    if ($chr !== FALSE) { $important_chroms[$chr] = TRUE; }
    fclose($fp);
    
    // Throw out everything but the top $contig_limit contigs
    arsort($chrom_sizes);
    $orig_chrom_sizes_length = count($chrom_sizes);
    $biggest_contigs = array_slice($chrom_sizes, 0, $contig_limit);
    foreach ($biggest_contigs as $chr => $size) {
      if (!array_key_exists($chr, $important_chroms)) {
        $rows[] = array($chr, $chrom_sizes[$chr]);
        $i++;
        if ($i > $contig_limit) { break; }
      }
    }
    
    $looks_roman = looksRomanToMe(array_keys($important_chroms));
    usort($rows, "chrSort");
  
    $response['db'] = $db;
    $response['limit'] = $contig_limit;
    $response['skipped'] = $orig_chrom_sizes_length - $i;
    $response['mem'] = memory_get_usage();
    $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $rows));
  } elseif ($url_type == 'dir') {
    // this is a Quickload dir, with a contents.txt
    $response[$url] = array($nice_names => $genome_directory_names);
  } else {
    forbidden();
  }
} else {
  // We don't know what we want. get the contents.txts for all default IGB dirs
  foreach ($default_igb_dirs as $igb_dir) {
    // fetch the contents.txt, parse it...
    $response[$igb_dir] = array($nice_names => $genome_directory_names);
  }
}

echo json_encode($response);
