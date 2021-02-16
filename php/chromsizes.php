<?php
/**
 * This page retrieves chromosome sizes for a particular genome from UCSC
 **/

header("Content-type: application/json");
header("Cache-control: max-age=172800, public, must-revalidate");
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800)); // 2 days

require_once("../lib/setup.php");
require_once("../lib/ucsc_tracks.php");

$response = array();

$ucsc_config = ucsc_config();
$tmp_dir = $ucsc_config['tmp_dir'];
$mysql_authoritative = $ucsc_config['browser_mysql']['authoritative'];
$chrom_info_url = $ucsc_config['data_urls']['chrom_info'];
$track_db_path = $ucsc_config['ucsc_cached_track_db'];
$chrom_info_file = $ucsc_config['ucsc_cached_chrom_sizes'];
$cytoband_bed_path = $ucsc_config['ucsc_cached_track_cytoband'];

// Returns basic info for all UCSC genomes based on the public MySQL database
// Results are cached for 1 week since this data is required for every chromozoom page request
function getAllGenomes() {
  global $mysql_authoritative, $tmp_dir;
  
  $cache_file = "$tmp_dir/all-genomes.cached.json";
  if (@is_readable($cache_file) && time() - filemtime($cache_file) < 7 * 24 * 60 * 60) {
    return json_decode(file_get_contents("$tmp_dir/all-genomes.cached.json"), TRUE);
  }
  
  $conn = mysqli_connect($mysql_authoritative, 'genome', '', 'hgcentral');
  if ($conn === false) { return array( "error" => "Could not connect to UCSC's MySQL server"); }
  $query = 'SELECT name, genome, description, organism, scientificName FROM dbDb WHERE active = 1 ORDER BY orderKey ASC';
  $result = mysqli_query($conn, $query);
  if ($result === false) { 
    return array( "error" => "Error while querying UCSC's MySQL server: " . mysqli_error($conn)); 
  }
  
  $genomes = array();
  
  while ($row = mysqli_fetch_assoc($result)) {
    $genomes[] = array(
      "db" => $row['name'],
      "otherKeywords" => $row['genome'],
      "species" => $row['scientificName'],
      "assemblyDate" => $row['description']
    );
  }
  
  @file_put_contents($cache_file, json_encode($genomes));
  return $genomes;
}


if (isset($_GET['db'])) {
  // If the db parameter is provided, provide a sorted chrom.sizes file for this genome
  $db = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['db']);
  $contig_limit = isset($_GET['limit']) ? min(max(intval($_GET['limit']), 50), 20000) : 5000;
  
  $chrom_info_file = realpath(sprintf(dirname(dirname(__FILE__)) . "/" . $chrom_info_file, $db));
  $chrom_info_url = sprintf($chrom_info_url, $db);

  // To get the chrom.sizes, try the cached file first (faster), and if it's not there, use the public URL
  $top_chroms = getTopChromSizes($chrom_info_file, $contig_limit);
  if ($top_chroms === FALSE) { $top_chroms = getTopChromSizes($chrom_info_url, $contig_limit); }
  
  if ($top_chroms === FALSE) { 
    $response['error'] = TRUE;
  } else {
    $response['db'] = $db;
    $response['limit'] = $contig_limit;
    $response['skipped'] = $top_chroms['skipped'];
    $response['mem'] = memory_get_usage();
    $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $top_chroms['rows']));
    
    $also_include_tracks = FALSE;
    if (isset($_GET['tracks']) && strlen($_GET['tracks']) > 0) {
      $also_include_tracks = explode('|', preg_replace('/[^a-z0-9_|]/i', '', $_GET['tracks']));
    }
    
    $response['tracks'] = getTracksForDb($track_db_path, $db, 100, FALSE, FALSE, $also_include_tracks);
    $more_tracks = getTracksForDb($track_db_path, $db, 10000, FALSE, FALSE, FALSE, TRUE) > count($response['tracks']);
    $response['moreTracks'] = $more_tracks ? (dirname($_SERVER['REQUEST_URI']) . "/ucsc_tracks.php?db=$db") : FALSE;
    $response['categories'] = filterCategoriesForTracks($ucsc_config['ucsc_track_category_order'], $response['tracks']);
    
    $response['cytoBandIdeo'] = getCytoBandIdeo($cytoband_bed_path, $db);
  
    if (isset($_GET['meta'])) {
      foreach (getAllGenomes() as $genome) {
        if ($genome['db'] == $db) { 
          $response['species'] = $genome['species'];
          $response['assemblyDate'] = $genome['assemblyDate']; 
          break;
        }
      }
    }
  }
  
} else {
  // Otherwise, return an array of UCSC genome names, and species/assembly dates for each
  // Compare with UCSCClient#list_genomes and UCSCClient#get_species_and_date in lib/ucsc_stitch.rb
  $response = getAllGenomes();
}

echo json_encode($response);