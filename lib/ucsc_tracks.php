<?php

/* 
 * Utility functions for working with SQLite tracks.db databases saved by UCSC_tracks/get_tracks.py
 */

// Returns all tracks from tracks.db at or below the given `priority` for the UCSC genome $db
function getTracksForDb($track_db_path, $chromozoom_uri, $db, $priority=100, $count_only=FALSE) {
  $tracks = array();
  $track_data_dir = dirname(dirname($track_db_path));
  $track_db_file = realpath(sprintf(dirname(dirname(__FILE__)) . "/" . $track_db_path, $db)); 
  try { 
    @$track_db = new SQLite3($track_db_file, SQLITE3_OPEN_READONLY);
  } catch (Exception $e) { return $count_only ? 0 : $tracks; }
  
  $what = $count_only ? 'COUNT(*)' : '*';
  $stmt = $track_db->prepare("SELECT $what FROM tracks WHERE priority <= :priority ORDER BY priority, name");
  $stmt->bindValue(':priority', $priority, SQLITE3_INTEGER);
  $result = $stmt->execute();
  
  if ($count_only) { $row = $result->fetchArray(); return $row[0]; }
  
  while ($row = $result->fetchArray()) {
    $name = $row['name'];
    $location = (preg_match('#^https?://#', $row['location']) ? "" : "cache://$track_data_dir/") . $row['location'];
    $local_settings = json_decode($row['localSettings'], TRUE);
    $track = array(
      'name' => $name,
      'description' => $row['longLabel'],
      'shortLabel' => $row['shortLabel'],
      'grp' => $row['grpLabel'],
      'type' => littleToBigFormat($row['type']),
      'opts' => array_merge($local_settings, array(
        'bigDataUrl' => $location,
        'priority' => $row['priority'],
        'visibility' => $row['priority'] <= 1 ? 'show' : 'hide'
      ))
    );
    $tracks[] = $track;
  }
  
  return $tracks;
}

// Returns the cached uncompressed cytoBandIdeo track for the UCSC genome $db
function getCytoBandIdeo($cytoband_bed_path, $db) {
  $cytoband_bed_file = realpath(sprintf(dirname(dirname(__FILE__)) . "/" . $cytoband_bed_path, $db)); 
  try { 
    $cytobands = @file_get_contents($cytoband_bed_file);
  } catch (Exception $e) { return FALSE; }
  return $cytobands;
}