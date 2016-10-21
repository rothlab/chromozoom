<?php
/**
 * This page retrieves chromosome sizes for a particular genome from UCSC
 **/

header("Content-type: application/json");

require_once("../lib/setup.php");
require_once("../lib/ucsc_tracks.php");

$response = array();

$ucsc_config = ucsc_config();
$track_db_path = $ucsc_config['ucsc_cached_track_db'];
$db = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['db']);
$response = array();

if (isset($_GET['children_of'])) {
  $children_of = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['children_of']);
  $response['tracks'] = getTracksForDb($track_db_path, $db, 10000, $children_of);
} elseif (isset($_GET['search'])) {
  $search = $_GET['search'];
  $response['tracks'] = getTracksForDb($track_db_path, $db, 10000, FALSE, $search);
} else {
  $response['error'] = true;
}

echo json_encode($response);