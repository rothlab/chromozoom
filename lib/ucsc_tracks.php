<?php

require_once dirname(__FILE__) . "/chromsizes.php";

/* 
 * Utility functions for working with SQLite tracks.db databases saved by UCSC_tracks/get_tracks.py
 */

// Returns all tracks from the local UCSC track cache database $track_db_path at or below the given $priority
// Optional:
//   $parent_track - FALSE or string; only return tracks that are children of this track
//   $search - FALSE or string; only return tracks matching this keyword
//   $also_include - FALSE or array; force the given tracks to be included in the result
function getTracksForDb($track_db_path, $db, $priority=100, $parent_track=FALSE, $search=FALSE, $also_include=FALSE,
                        $count_only=FALSE) {
  $tracks = array();
  $keywords = array();
  $track_data_dir = dirname(dirname($track_db_path));
  $track_db_file = realpath(sprintf(dirname(dirname(__FILE__)) . "/" . $track_db_path, $db)); 
  try { 
    if (!file_exists($track_db_file)) { throw new Exception('No tracks.db database was created for this genome.'); }
    @$track_db = new SQLite3($track_db_file, SQLITE3_OPEN_READONLY);
  } catch (Exception $e) { return $count_only ? 0 : $tracks; }
  
  $what = $count_only ? 'COUNT(*)' : '*';
  $where = '1=1';
  if ($priority !== FALSE) { $where .= ' AND priority <= :priority'; }
  if ($parent_track !== FALSE) { $where .= ' AND parentTrack = :parent AND name != :parent'; }
  if ($search !== FALSE) {
    $keywords = preg_split("/[\s,]+/", $search);
    foreach ($keywords as $i => $keyword) {
      $where .= " AND (shortLabel LIKE :search$i OR longLabel LIKE :search$i OR name LIKE :search$i)";
    }
  }
  if (is_array($also_include) && count($also_include)) { 
    $where .= ' OR name IN (' . implode(',', preg_filter('/^/', ':inc', range(1, count($also_include)))) . ')';
  }
  
  $stmt = $track_db->prepare("SELECT $what FROM tracks WHERE $where ORDER BY priority, srt, name");
  if ($priority !== FALSE) { $stmt->bindValue(':priority', $priority, SQLITE3_INTEGER); }
  if ($parent_track !== FALSE) { 
    $stmt->bindValue(':parent', $parent_track, SQLITE3_TEXT);
  }
  if (count($keywords) > 0) { 
    foreach($keywords as $i => $keyword) {
      $stmt->bindValue(':search' . $i, "%$keyword%", SQLITE3_TEXT);
    }
  }
  if (is_array($also_include)) {
    foreach($also_include as $i => $track) { $stmt->bindValue(":inc" . ($i + 1), $track, SQLITE3_TEXT); }
  }
  
  $result = $stmt->execute();
  
  if ($count_only) { $row = $result->fetchArray(); return $row[0]; }
  
  while ($row = $result->fetchArray()) {
    $name = preg_replace('#^all_#', '', $row['name']);
    $location = (preg_match('#^https?://#', $row['location']) ? "" : "cache://$track_data_dir/") . $row['location'];
    $local_settings = json_decode($row['localSettings'], TRUE);
    $composite_track_child = $row['parentTrack'] != $name;
    
    $override_settings = array(
      'bigDataUrl' => $location,
      'priority' => $row['priority']
    );
    if (!$composite_track_child) { $override_settings['visibility'] = $row['priority'] <= 1 ? 'show' : 'hide'; }

    $track = array(
      'name' => $name,
      'description' => $row['longLabel'],
      'shortLabel' => $row['shortLabel'],
      'composite' => $row['compositeTrack'],
      'grp' => $row['grpLabel'],
      'srt' => $row['srt'],
      'type' => littleToBigFormat($row['type']),
      'opts' => array_merge($local_settings, $override_settings)
    );
    if ($composite_track_child) { $track['parent'] = $row['parentTrack']; }
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