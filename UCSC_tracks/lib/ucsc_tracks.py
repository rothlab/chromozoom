from lxml import html
import pymysql.cursors
import sqlite3
import urllib.request
from urllib.error import URLError
import os, sys
import subprocess as sbp
import re
import json
import fileinput
import time
import gzip
import zlib
from shutil import copyfile
from collections import OrderedDict
from tqdm import tqdm
import logging as log
import traceback
from shlex import quote as q

from .autosql import AutoSqlDeclaration
from . import config as cfg

SCRIPT_DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BIGBED_FORMATS = ['bigBed', 'bigLolly', 'bigBarChart', 'bigGenePred', 'bigPsl', 'bigDbSnp']
BIG_FORMATS = BIGBED_FORMATS + ['bigWig', 'bam', 'vcfTabix']

BEDLIKE_FORMATS = {
    # format: (as_location, bed_type)
    'bed': (None, None),
    'genePred': ('autosql/genePredFull.as', 'bed12+8'),
    'psl': ('autosql/bigPsl.as', 'bed12+12'),
    'gvf': ('autosql/bigGvf.as', 'bed8+3'),
    'broadPeak': ('autosql/bigBroadPeak.as', 'bed6+3'),
    'narrowPeak': ('autosql/bigNarrowPeak.as', 'bed6+4'),
    'rmsk' : ('autosql/bigRmsk.as', 'bed6+6'),
    'barChart': ('autosql/bigBarChart.as', 'bed6+5'),
    'pgSnp' : ('autosql/bigPgSnp.as', 'bed4+3'),
    'chain' : ('autosql/bigChain.as', 'bed6+6')
}
# For some reason bedToBigBed fails to create an extraIndex for BED files above this
# length, roughly 27GB. Therefore, it's best to disable extraIndex'es for such large BED files.
MAX_INDEXABLE_BED_SIZE = 27000 * 1000000
# Don't bother fetching gzipped table data above this size, because they are liable to expand
# beyond the aforementioned limit.
MAX_TSV_GZ_SIZE = 3000 * 1000000

# If any simple query takes longer than this (in seconds), a connection probably stalled
REQUEST_TIMEOUT = 30

# A place to send output that we don't want
NULL_DEVICE = open(os.devnull, 'w')


class TrackInfo(dict):
    def __init__(self, *args):
        self.groups = {}
        dict.__init__(self, args)


def crc32_of_file(file_name):
    with open(file_name, 'rb') as fh:
        hash = 0
        while True:
            s = fh.read(65536)
            if not s:
                break
            hash = zlib.crc32(s, hash)
        return "%08X" % (hash & 0xFFFFFFFF)


def create_sqllite3_db(organism):
    """
    Checks if the local sqlite3 .db has been created, and if not, creates it. Returns the .db location.
    """
    db_loc = './{}/tracks.db'.format(organism)

    new_db = True
    if os.path.isfile(db_loc):
        new_db = False

    xconn = sqlite3.connect(db_loc)
    if new_db:
        xconn.execute("CREATE TABLE tracks (name, displayName, type, grp, grpLabel, parentTrack, trackLabel, "
                      "shortLabel, longLabel, priority, location, html longblob, updateDate, "
                      "remoteSettings, localSettings, compositeTrack, srt);")
        xconn.execute("CREATE UNIQUE INDEX ix_tracks_name on tracks(name);")
    return db_loc, xconn

    
def get_last_local_updates(localconn):
    return dict(localconn.execute('SELECT name, updateDate FROM tracks;').fetchall())


def cmd_exists(cmd):
    """
    Check if a given executable is on $PATH
    For more on the `type` shell builtin, see https://bash.cyberciti.biz/guide/Type_command
    """
    return sbp.call("type " + cmd, shell=True, stdout=sbp.PIPE, stderr=sbp.PIPE) == 0


def pv():
    """Use pv when available, which gives us pretty progress bars in the terminal"""
    return 'pv ' if (cmd_exists('pv') and log.root.level <= log.INFO) else 'cat '
    

def ensure_hg_conf(homedir):
    """
    Some kentutils, such as `hgWiggle`, need an .hg.conf file to be in $HOME with MySQL connection info
    """
    if not os.path.isfile(homedir + '/.hg.conf'):
        with open(homedir + '/.hg.conf', 'w') as f:
            cfg = ("db.host=%s", "db.user=genomep", "db.password=password", "central.db=hgcentral")
            f.write("\n".join(cfg) % cfg.mysql_host())
    os.chmod(homedir + '/.hg.conf', 0o600)
    
    
def url_exists(url):
    url = re.sub(r'^rsync://', 'http://', url)
    req = urllib.request.Request(url, method="HEAD")
    try:
        urllib.request.urlopen(req)
    except URLError:
        return False
    return True


def url_content_length(url):
    url = re.sub(r'^rsync://', 'http://', url)
    try:
        command = "curl -sI  %s | grep -i Content-Length | awk '{print $2}'" % q(url)
        content_length = int(sbp.check_output(command, shell=True).strip())
    except:
        return None
    return content_length


def format_bytes(size):
    power = 1000
    n = 0
    power_labels = {0 : '', 1: 'K', 2: 'M', 3: 'G', 4: 'T'}
    while size > power:
        size /= power
        n += 1
    return "{:.1f}{}B".format(size, power_labels[n])


def qups(in_cmd, ucur):
    """
    Executes MySQL query and returns parsed results
    """
    ucur.connection.ping(reconnect=True)
    ucur.execute(in_cmd)
    return ucur.fetchall()


def connect_to_ucsc_mysql(host, db):
    try:
        conn = pymysql.connect(host=host, user='genome', database=db, read_timeout=REQUEST_TIMEOUT)
        return conn, conn.cursor()
    except pymysql.err.InternalError:
        log.warning('No MySQL tables found for "%s". Skipping...', organism)
        return None


def parse_trackdb_settings(settings):
    """
    Parses a `settings` field from a UCSC trackDb table into a dictionary of keys -> values
    See also: https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html
    """
    parsed_settings = dict()
    for line in (settings).decode("latin1").replace("\\\n", " ").split("\n"):
        try: key, value = re.split(r'\s+', line, 1)
        except ValueError: continue
        parsed_settings[key] = value
    return parsed_settings


def get_last_remote_updates(xcur, db, tracks_to_table_names):
    """
    Fetches table update times
    """
    tables_to_track_names = {v: k for k, v in tracks_to_table_names.items()}
    in_clause = ','.join(['"' + table_name + '"' for table_name in tracks_to_table_names.values()])
    result = qups(("SELECT TABLE_NAME, UPDATE_TIME FROM information_schema.tables "
                   "WHERE TABLE_SCHEMA='{}' AND TABLE_NAME IN ({})").format(db, in_clause), xcur)
    return dict([(tables_to_track_names[row[0]], str(row[1])) for row in result])


def get_last_location_and_bed_plus_fields(localconn, track_name):
    """
    Fetches these metadata for a track entry that was saved to the local database during the last update
    """
    prev_row = localconn.execute(
            'SELECT location, localSettings FROM tracks WHERE name="{}";'.format(track_name)).fetchone()
    if prev_row is None:
        raise RuntimeError("Previous entry for track {} could not be retrieved".format(track_name))
    settings = json.loads(prev_row[1])
    return prev_row[0], settings['bedPlusFields'].split(',') if settings.get('bedPlusFields') else None


def get_numrows(xcur, table_name):
    return qups("SELECT COUNT(*) FROM {}".format(table_name), xcur)[0][0]


def get_organisms_list(host='', prefix='', skip=''):
    """
    Get list of organism databases that we may want to scrape from UCSC
    """
    prefix_query = ''
    if prefix is not '':
        prefix_query += " AND (name LIKE '" + ("%' OR name LIKE '".join(prefix.split(','))) + "%')"
    if skip is not '':
        for skip_prefix in skip.split(','): prefix_query += " AND name NOT LIKE '{}%'".format(skip_prefix)
    try:
        conn = pymysql.connect(host=host, user='genome', database='hgcentral')
        xcur = conn.cursor()
    except pymysql.err.InternalError:
        log.critical('Could not connect to UCSC MySQL server at "%s". Exiting.', host)
        sys.exit(65)
    
    org_names = qups("SELECT name FROM dbDb WHERE active = 1{} ORDER BY orderKey ASC".format(prefix_query),
                     xcur)
    org_names = [name[0] for name in org_names]
    
    return org_names


def get_tables(db='', tgroup='', xtrack='', table_source=''):
    mytree = html.parse("{}?db={}&hgta_group={}&hgta_track={}".format(table_source, db, tgroup, xtrack))
    search_taids = mytree.xpath('//select[@name="hgta_table"]/option/@value')
    search_tanames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_table"]/option/text()')]

    return dict(zip(search_taids, search_tanames))


def get_tracks_in_group(db='', tgroup='', table_source=''):
    mytree = html.parse("{}?db={}&hgta_group={}".format(table_source, db, tgroup))

    search_tids = mytree.xpath('//select[@name="hgta_track"]/option/@value')
    search_tnames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_track"]/option/text()')]

    return dict(zip(search_tids, search_tnames))


def get_track_groups(db='', table_source=''):
    """
    Returns dictionary of track groups => track names.
    """
    mytree = html.parse("{}?db={}".format(table_source, db))
    search_gids = mytree.xpath('//select[@name="hgta_group"]/option/@value')
    search_gnames = [xel.strip() for xel in mytree.xpath('//select[@name="hgta_group"]/option/text()')]
    groups_dict = dict(zip(search_gids, search_gnames))

    # remove all_tables and all tracks
    if 'allTables' in groups_dict:
        groups_dict.pop('allTables')
    if 'allTracks' in groups_dict:
        groups_dict.pop('allTracks')

    if db not in mytree.xpath('//select[@name="db"]/option/@value'):
        return None

    return groups_dict


def get_priority(db, selection, tracks_source, track_info):
    """
    Returns dictionary of tracks -> priorities, which are numbers (lower number means higher priority)
    
    The primary gene track(s) gets the highest priority and is visible by default;
    tracks that are visible in UCSC by default get medium priority and are loaded into the track list;
    all other tracks are low priority, and are searchable but not loaded into the track list by default
    """
    # The first gene track in the track UI is considered the primary gene track, with a couple exceptions
    special_high_priority = ['sgdOther']
    mytree = html.parse("{}?db={}".format(tracks_source, db))
    track_form = mytree.xpath('//form[@id="TrackForm"]')
    gene_tracks = []
    priorities = {}
    
    if len(track_form) > 0:
        track_form = track_form[0]
        gene_tracks = track_form.xpath('//tr[starts-with(@id,"genes-")]//select/@name')
    if len(gene_tracks) == 0:
        log.critical('Cannot parse browser page for "%s" to determine track priorities. Exiting.', db)
        sys.exit(66)
    
    for track in selection:
        parent_track = track_info[track]['parentTrack']
        track_default_visibility = track_form.xpath('//select[@name="{}"]/option[@selected]/text()'.format(track))
        parent_default_visibility = track_form.xpath('//select[@name="{}"]/option[@selected]/text()'.format(parent_track))
        if track == gene_tracks[0] or track in special_high_priority:
            priorities[track] = 1
        elif len(track_default_visibility) > 0 and track_default_visibility[0] != 'hide':
            priorities[track] = 10
        elif len(parent_default_visibility) > 0 and parent_default_visibility[0] != 'hide':
            priorities[track] = 30
        else:
            priorities[track] = 100
        
        if parent_track != track:
            # Composite track subtracks incur additional penalty proportional to number of subtracks
            num_subtracks = len([k for (k, v) in track_info.items() if v['parentTrack'] == parent_track])
            penalty = 3 if num_subtracks > 30 else (2 if num_subtracks > 10 else (1.5 if num_subtracks > 3 else 0.5))
            priorities[track] = int(priorities[track] * penalty)
        
    return priorities
    

def create_hierarchy(organism, table_source):
    """
    Creates a file with the tracks => tables hierarchy for a given organism.
    """
    save_dir = './{}'.format(organism)
    location = save_dir + '/table_hierarchy.txt'.format(organism)

    if not os.path.isdir(save_dir):
        os.mkdir(save_dir)
    if os.path.isfile(location):
        return location

    w_file = open(location, 'w')

    print("Organism: {}".format(organism), file=w_file)
    org_groups = get_track_groups(organism, table_source=table_source)

    if not org_groups:
        w_file.close()
        os.remove(location)
        return None

    for group in org_groups:
        print('\tTrackgroup: {} ({})'.format(group, org_groups[group]), file=w_file)
        tracks_in_group = get_tracks_in_group(organism, group, table_source)

        for track in tracks_in_group:
            print('\t\tTrack: {} ({})'.format(track, tracks_in_group[track]), file=w_file)
            tables = get_tables(organism, group, track, table_source)
            for table in tables:
                print('\t\t\tTable: {} ({})'.format(table, tables[table]), file=w_file)
    return location


def distill_hierarchy(hierarchy_location, include_composite_tracks=False):
    """
    Parses the file we created with the tracks => tables hierarchy, and depending on whether we want to 
    fetch composite tracks or not, returns a list of selected tracks and a TrackInfo() object with 
    information on all the tracks (and their subtracks, for composite tracks), as well as track groups.
    """
    selected_tracks = []
    track_info = TrackInfo()
    curr_tgroupname = None
    curr_track = None
    curr_trackname = None
    curr_table = None
    curr_track_tables = []
    curr_track_lines = dict()
    
    def process_tables():
        nonlocal curr_track_tables, selected_tracks, track_info
        if len(curr_track_tables) == 0: return
        
        # If a track contains an identically named table, that table holds the track's data, and it's a "simple track"
        #   - One exception: the table is sometimes prefixed by "all_" e.g. hg38.all_est
        simple_track = [table for table in [curr_track, "all_" + curr_track] if table in curr_track_tables]
        
        if simple_track:
            selected_tracks.append(curr_track)
            track_info[curr_track] = {
                'displayName': curr_trackname,
                'trackLabel': curr_trackname,
                'groupLabel': curr_tgroupname,
                'parentTrack': curr_track
            }
        else:
            # A track that does NOT contain a table with an identical name must be a "composite track"
            # These tracks contain many subtracks of the same type (each with its own table), sharing certain settings
            # See https://genome.ucsc.edu/goldenpath/help/trackDb/trackDbHub.html#Composite_Track_Settings
            if include_composite_tracks:
                selected_tracks.append(curr_track)
                track_info[curr_track] = {
                    'displayName': curr_trackname,
                    'trackLabel': curr_trackname,
                    'groupLabel': curr_tgroupname,
                    'parentTrack': curr_track
                }
                for table in curr_track_tables:
                    table = re.sub(r'^all_', '', table)
                    if table in track_info: continue  # Never steal away a simple track's table into a composite track
                    selected_tracks.append(table)
                    table_line = curr_track_lines[curr_table]
                    track_info[table] = {
                        'displayName': table_line.split('(', 1)[1][:-2],
                        'trackLabel': curr_trackname,
                        'groupLabel': curr_tgroupname,
                        'parentTrack': curr_track
                    }
        curr_track_tables = []

    with open(hierarchy_location, 'r') as handle:
        for line in handle:
            if re.match(r'^\s*Trackgroup:', line):
                process_tables()
                curr_tgroupname = line.split('(', 1)[1][:-2]
                track_info.groups[line.split()[1]] = curr_tgroupname
            elif re.match(r'^\s*Track:', line):
                process_tables()
                curr_track = line.split()[1]
                curr_trackname = line.split('(', 1)[1][:-2]
            elif re.match(r'^\s*Table:', line):
                curr_table = line.split()[1]
                curr_track_tables.append(curr_table)
                curr_track_lines[curr_table] = line
    process_tables() # Process last track's tables.
    
    return selected_tracks, track_info


def tracks_to_table_names(wanted_tracks, organism, xcur):
    """
    Checks which tracks in wanted_tracks can be extracted from UCSC databases, returns a filtered list
    """
    first_chrom = first_chrom_name(organism)
    if first_chrom is None:
        log.critical("Couldn't fetch chrom.sizes for %s", organism)
        sys.exit(71)

    actual_table_names = set([table[0] for table in qups("SHOW TABLES", xcur)])
    
    # Some tracks have a table manually specified in their trackDb settings
    manually_set_tables = dict()
    for track, settings in qups("SELECT tableName, settings FROM trackDb WHERE settings LIKE '%table %'", xcur):
        settings = parse_trackdb_settings(settings)
        if "table" in settings: manually_set_tables[track] = settings["table"]
    
    track_to_table = {}
    for track in wanted_tracks:
        possible_table_names = [manually_set_tables[track]] if track in manually_set_tables else []
        # Allow some tracks (e.g., mrna and est) to by prefixed by "all_" or sharded by chr name
        possible_table_names += [track, "all_" + track, first_chrom + "_" + track]
        found_table = next((table for table in possible_table_names if table in actual_table_names), None)
        if found_table is not None:
            track_to_table[track] = found_table
    
    return track_to_table


def filter_tracks_by_args(selected_tracks, args, track_priority):
    """
    Applies --priority_below, --track_prefix, and --skip_tracks filters to a list of track names
    """
    new_selected_tracks = []
    track_prefixes = list(filter(len, args.track_prefix.split(',')))
    skip_tracks = list(filter(len, args.skip_tracks.split(',')))
    for trk in selected_tracks:
        if args.priority_below is not None and track_priority[trk] > args.priority_below: continue
        if len(track_prefixes) > 0 and next((s for s in track_prefixes if trk.startswith(s)), None) is None: continue
        if len(skip_tracks) > 0 and next((s for s in skip_tracks if trk.startswith(s)), None) is not None: continue
        new_selected_tracks.append(trk)
    return new_selected_tracks


def fetch_tracks(xcur, selection=None):
    """
    Fetches track information from the specified UCSC database, which is in the trackDb table
    """
    if selection is not None:
        if len(selection) == 0: return []
        # the trackDb table drops the "all_" prefix for certain tables, like all_mrna and all_est
        fixed_selection = [re.sub(r'^all_', '', element) for element in selection]
        in_clause = ','.join(['"' + element + '"' for element in fixed_selection])
        tracks = qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings, url, priority "
                       "FROM trackDb WHERE tableName IN ({})").format(in_clause), xcur)
    else:
        tracks = qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings, url, priority "
                       "FROM trackDb ORDER BY tableName"), xcur)
    
    tracks = [list(track) for track in tracks]
    for track in tracks:
        track.append([]) # children, which these non-supertracks don't need to specify
        if "all_" + track[0] in selection:
            track[0] = "all_" + track[0]
    
    return tracks


def fetch_supertracks(xcur, track_info):
    """
    Fetches supertrack information from the specified UCSC database, which is in the trackDb table
    """
    tracks = qups("SELECT tableName, type, grp, shortLabel, longLabel, html, settings, url, priority "
                  "FROM trackDb WHERE settings REGEXP '\\nsuperTrack on( |\\n)' ORDER BY tableName", xcur)
    
    tracks = [list(track) for track in tracks]
    for track in tracks:
        track[1] = 'supertrack'
        track_info[track[0]] = {
            'displayName': track[3],
            'trackLabel': track[3],
            'groupLabel': track_info.groups[track[2]],
            'parentTrack': track[0]
        }
        children = qups(("SELECT tableName FROM trackDb WHERE settings REGEXP '\\nsuperTrack {}( |\\n)'"
                         " OR settings REGEXP '\\nparent {}( |\\n)'").format(track[0], track[0]), xcur)
        track.append([child[0] for child in children])
    
    return tracks


def fetch_view_settings(xcur, view_track_name, parent_track):
    tracks = qups(("SELECT settings FROM trackDb WHERE tableName = \"{}\"").format(view_track_name), xcur)
    if len(tracks) > 0:
        settings = parse_trackdb_settings(tracks[0][0])
        if 'view' in settings and 'parent' in settings and settings['parent'].split()[0] == parent_track:
            return settings
        else:
            log.warning('Tried to fetch view "%s" (parent "%s"), settings invalid', view_track_name, parent_track)
            log.debug('Settings were: %s', settings)
    return None


def setup_directories(organism):
    """
    Sets up directories and files needed for track fetching for one organism
    """
    if not os.path.exists(organism): os.makedirs(organism)
    if not os.path.exists(organism + '/build'): os.makedirs(organism + '/build')
    if not os.path.exists(organism + '/bigBed'): os.makedirs(organism + '/bigBed')
    if not os.path.exists(organism + '/bigWig'): os.makedirs(organism + '/bigWig')


def is_bedlike_format(track_type):
    """
    Is the given track type convertable to BED/bigBed? 
    If so, returns the track type (minus its arguments), otherwise returns False.
    """
    track_type = re.split(r'\s+', track_type)
    return track_type[0] if track_type[0] in BEDLIKE_FORMATS else False


def get_as_and_bed_type_for_bedlike_format(track_type, bed_location=None):
    """
    Is the given track type convertable to BED/bigBed? 
    If so, and `bed_location` is None, returns the location of the correct autoSql file, and the BED subtype (bedN+N).
    If `bed_location` is given, copies that autoSql file alongside the BED file and returns its new location instead.
    Otherwise, raises a KeyError.
    """
    track_type = re.split(r'\s+', track_type)
    from_location, bed_subtype = BEDLIKE_FORMATS[track_type[0]]
    if from_location is not None and bed_location is not None:
        to_location = re.sub(r'\.bed$', '.as', bed_location)
        if not os.path.isfile(to_location) or os.stat(to_location).st_size == 0:
            copyfile(os.path.join(SCRIPT_DIRECTORY, from_location), to_location)
        return to_location, bed_subtype
    return from_location, bed_subtype


def get_bed_type_for_bigbed(bb_location):
    """
    Reads the BED type as a tuple (e.g. bed6+3 -> (6,3)) from a bigBed file's binary header
    For more, see the supplemental of https://academic.oup.com/bioinformatics/article/26/17/2204/199001
    """
    with open(bb_location, 'rb') as f:
        magic = f.read(4)
        byte_order = "little" if magic == b'\xeb\xf2\x89\x87' else "big"
        f.seek(32)
        field_count = int.from_bytes(f.read(2), byte_order, signed=False)
        defined_field_count = int.from_bytes(f.read(2), byte_order, signed=False)
        return defined_field_count, field_count - defined_field_count
    return None, None
        

def fetch_autosql_for_bigbed(bb_location):
    command = "bigBedInfo {}".format(q(bb_location))
    command_with_as = "bigBedInfo -as {}".format(q(bb_location))
    try:
        bb_info = sbp.check_output(command, shell=True)
        bb_info_with_as = sbp.check_output(command_with_as, shell=True)
        as_finder = re.compile(b'^basesCovered: ', re.MULTILINE)
        match = as_finder.search(bb_info)
        if match is None or b'as:\n' not in bb_info_with_as:
            log.warning('Couldn\'t fetch autoSql for bigbed file at "%s"', bb_location)
            return None
        # Clips out the b"as:\n"
        return bb_info_with_as[match.start() + 4 : -len(bb_info) + match.start()].decode('latin1')
    except sbp.CalledProcessError:
        log.warning('Couldn\'t fetch bigBedInfo for location "%s"', bb_location)
        log.debug('Used command: %s', command)
        return None
    return None


def fetch_asql_file(xcur, organism, bed_location, table_name):
    """
    Creates an autoSql file from UCSC's table metadata and returns its location.
    Applies a few basic cleanup operations before the autoSql file is saved.
    """
    as_file = bed_location[:-4] + '.as'
    
    first_chrom = first_chrom_name(organism)
    if first_chrom is None: log.critical("Couldn't fetch chrom.sizes for %s", organism); sys.exit(71)
    table_name = re.sub('^' + re.escape(first_chrom) + '_', 'chrN_', table_name)
    
    query = 'SELECT autoSqlDef FROM tableDescriptions WHERE tableName IN ("{}", "all_{}") LIMIT 1;'
    as_contents = qups(query.format(table_name, table_name, table_name), xcur)[0][0].decode('latin1').strip()
    as_contents = re.sub(r'\n(\s*\n)+', '\n', as_contents) # Kill any whitespace-only lines
    
    # Remove any fields with the name 'bin'
    bin_rows = re.compile('[\t\s]*(short|uint|string|ushort)[\t\s]+bin;')
    if bin_rows.search(as_contents):
        as_contents = '\n'.join([line for line in as_contents.split('\n') if not bin_rows.match(line)])

    # Change any deprecated itemRgb fields that use an unsigned integer
    old_colors = 'uint itemRgb;'
    if old_colors in as_contents:
        replace_line = '    uint reserved;     "Used as itemRgb as of 2004-11-22"'
        as_contents = '\n'.join([replace_line if old_colors in line else line for line in as_contents.split('\n')])

    w_file = open(as_file, 'w')
    w_file.write(as_contents)

    return as_file


def fetch_table_fields(xcur, table_name):
    return [val[0] for val in qups("SHOW columns FROM {}".format(table_name), xcur)]


def fetch_chrom_sizes(organism):
    """
    Fetches the chrom.sizes file for a genome into the local build directory and returns its new path
    As a fallback, can also convert chromInfo table data into a chrom.sizes file
    """
    chrom_sizes_file = "./{0}/build/chrom.sizes.txt".format(organism)
    if not os.path.isfile(chrom_sizes_file) or os.stat(chrom_sizes_file).st_size == 0:
        urls = list(map(lambda url: url % (organism, organism), cfg.downloads_chrom_sizes()))
        if not rsync_or_curl(urls, chrom_sizes_file):
            urls = [cfg.downloads_chrom_info() % organism]
            chrom_info_gz = chrom_sizes_file + '.gz'
            try:
                if not rsync_or_curl(urls, chrom_info_gz): raise URLError("chromInfo.txt.gz not available")
                command = pv() + "{} | gzcat | cut -f 1,2 >{}".format(q(chrom_info_gz), q(chrom_sizes_file))
                sbp.check_call(command, shell=True) 
                os.unlink(chrom_info_gz)
            except (sbp.CalledProcessError, URLError) as err:
                log.warning('[db %s] FAILED: Couldn\'t fetch chromosome info', organism)
                return None
    return chrom_sizes_file
    

def chrom_sizes_as_odict(organism):
    """
    Fetches the chrom.sizes file for a genome into an OrderedDict mapping chr => size
    Returns None if unavailable
    """
    chrom_sizes_file = fetch_chrom_sizes(organism)
    if chrom_sizes_file is None: return None
    chrom_sizes = OrderedDict()
    with open(chrom_sizes_file, 'r') as f:
        for line in f.read().split('\n'):
            fields = line.split()
            if len(fields) == 2: chrom_sizes[fields[0]] = int(fields[1])
    return chrom_sizes


def first_chrom_name(organism):
    chrom_sizes = chrom_sizes_as_odict(organism)
    return None if chrom_sizes is None else next(iter(chrom_sizes.keys()))


def fix_bed_and_as_files(organism, bed_file, bed_type, asql_file=None):
    """
    Tries to fix the BED and autoSql files if initial BigBed building failed.
    
    There are several fixes applied to the BED file:

    1) BED data on invalid contigs (checked against chrom.sizes.txt) are filtered out of the BED file.
    2) BED columns claiming to be standard types per the `bed_type` are validated; `bed_type` is adjusted if needed.
    3) If it is being used as a standard `score` field, the 5th column in the BED file is clipped to the range of 0-1000.
    
    If an autoSql file is provided as `asql_file`:
    
    4) Fields in the autoSql are reset to default types and names if claimed to be standard and validated as such in #2.
    5) The remaining fields are renamed so that there are no collisions with default names.
    6) If the autoSql contains fields not in the (first line of the) BED file, these are trimmed.
    7) 'string' fields in the autoSql that are longer than 255 bytes in the BED data are upsized to 'lstring'.
    
    Note that these fixes should be idempotent, i.e. there is no change if the fixing process runs multiple times.

    Returns a new BED type "bedN+N" that reflects validated field counts (standard and non-standard) in the BED file.
    """
    # TODO: Other fixes we should implement, based on errors that occur in hg38 or hg19:
    # - Errors with BED blocks, e.g: "BED blocks must be in ascending order without overlap. Blocks 4 and 5 overlap"
    # ---- possibly addressable with `-allow1bpOverlap` flag for `bedtoBigBed`?
    # --------- That didn't fix 0-width blocks, e.g. blockStarts [74,74] blockWidths [0,3]
    # - BED features overrunning the end of a chr, e.g. "End coordinate 15279395 bigger than chrII size of 15279316"
    # - Some .as files (eg hg19:ucscToINSDC.as) have malformed quoted strings (low priority)

    REQUIRED_COLUMNS = 3
    DEFAULT_TYPES = ['string', 'uint', 'uint', 'string', 'uint', 'char[1]', 'uint', 'uint', 'uint']
    TYPE_REGEXES = {'string': r'^.{0,255}$', 'uint': r'^\d+$', 'char[1]': r'^.$'}
    DEFAULT_NAMES = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'reserved']
    
    chrom_sizes = chrom_sizes_as_odict(organism)
    if chrom_sizes is None: return bed_type  # Failed to fetch chrom.sizes, can't proceed
    
    bed_nums = list(map(int, re.findall(r'\d+', bed_type)))
    field_count = None
    bed_lines_dropped = 0
    field_sizes = None
    valid_default_fields = bed_nums[0]
    pbar_file = sys.stderr if log.root.level <= log.INFO else NULL_DEVICE

    with tqdm(desc="Fixing BED file", total=os.path.getsize(bed_file), file=pbar_file) as pbar:
        with fileinput.input(bed_file, inplace=True) as f:
            for line in f:
                pbar.update(len(line))
                fields = line.strip().split('\t')
                if field_count is None: field_count = len(fields)
                if field_sizes is None: field_sizes = [0] * field_count

                # Drop any BED data that doesn't map to a valid chr (contig name)
                if fields[0] not in chrom_sizes: 
                    bed_lines_dropped += 1
                    continue
                
                # If it was intended to be a standard `score` field, clip the 5th column in the BED file to the range of 0-1000.
                if bed_nums[0] >= 5 and len(fields) >= 5:
                    try: score = int(fields[4])
                    except ValueError: score = 1000
                    score = min(max(score, 0), 1000)
                    fields[4] = str(score)
        
                for i, field in enumerate(fields):
                    # Tally up the max widths of each of the fields, if >255 can upconvert string -> lstring in the autosql.
                    field_sizes[i] = max(field_sizes[i], len(field))
                    # Check how many columns of the BED match up with the DEFAULT_TYPES
                    if i < min(valid_default_fields, len(DEFAULT_TYPES)):
                        if not re.match(TYPE_REGEXES[DEFAULT_TYPES[i]], field): valid_default_fields = i
                
            print('\t'.join(fields))
        
    if valid_default_fields < REQUIRED_COLUMNS:
        log.warning('[db %s] Cannot fix %s - First 3 columns MUST be string, uint, uint', organism, bed_file)
        return bed_type
    
    if valid_default_fields < bed_nums[0]: log.debug('%i cols don\'t match defaults', bed_nums[0] - valid_default_fields)
    if bed_lines_dropped > 0: log.debug('dropped %i lines on invalid contigs from "%s"', bed_lines_dropped, bed_file)
    bed_nums[0] = valid_default_fields

    if asql_file:
        with open(asql_file, 'r') as f: asql_lines = re.sub(r'\n(\s*\n)+', '\n', f.read().strip()).split('\n')

        # Resets the initial fields in the autoSql that we've validated as conforming to the BED standard
        #    which will be the new first number in the BED type (e.g. "bed 6 + 2" => 6 standard fields)
        #    (this fixes bedToBigBed errors like "column #4 names do not match: Yours=[id]  BED Standard=[name]")
        # Also automatically upsizes 'string' non-standard fields that are >255 bytes wide to 'lstring' fields
        for fnum, line in enumerate(asql_lines[3:-1]):
            lnum = fnum + 3
            field_size = field_sizes[fnum] if fnum < len(field_sizes) else 0
            dtype = DEFAULT_TYPES[fnum] if fnum < len(DEFAULT_TYPES) else None
            dname = DEFAULT_NAMES[fnum] if fnum < len(DEFAULT_NAMES) else None
        
            ftype, rest = line.split(maxsplit=1)
            if fnum < bed_nums[0] and dtype is not None: line = dtype + ' ' + rest
            elif ftype == 'string' and field_size > 255: line = 'lstring ' + rest
        
            ftypename, rest = line.split(';', maxsplit=1)
            ftype, fname = ftypename.rsplit(maxsplit=1)
            # When renaming fields, have to avoid collisions with non-default fields that are named the same
            if fnum < bed_nums[0] and dname is not None: fname = dname
            elif fname in DEFAULT_NAMES[:bed_nums[0]]: fname = fname + '2'
            asql_lines[lnum] = '; '.join([ftype + ' ' + fname, rest])

        del asql_lines[3 + field_count : -1]  # remove autoSQL fields that aren't actually in the BED file
        with open(asql_file, 'w') as f: f.write('\n'.join(asql_lines))

    bed_nums = [bed_nums[0], field_count - bed_nums[0]] if field_count > bed_nums[0] else [bed_nums[0]]
    new_bed_type = "bed" + "+".join(map(str, bed_nums))
    log.info('[db %s] Fixed AS/BED files at %s (bed type %s -> %s)', organism, bed_file, bed_type, new_bed_type)
    with open(bed_file + '.wasfixed', 'w') as f: f.write(new_bed_type)  # Marks that we fixed the BED/AS files already
    return new_bed_type


def rsync_or_curl(from_urls, to_path, retries=3, max_size=None):
    from_urls = [from_urls] if isinstance(from_urls, str) else from_urls
    
    returncode = None
    while returncode != 0 and retries > 0:
        from_url = from_urls[0]
        if len(from_urls) > 1: from_urls.pop(0)
        http_url = re.sub(r'^rsync://', 'http://', from_url)
        if max_size is not None:
            content_length = url_content_length(http_url)
            if content_length is not None and content_length > max_size:
                log.warn("Table data at %s exceeded max_size %s", from_url, format_bytes(max_size))
                return False
        
        if cmd_exists('rsync') and from_url[0:8] == 'rsync://':
            partial_progress_flag = '-P' if log.root.level <= log.INFO else '--partial'
            command = "rsync -avz {} --no-R --no-implied-dirs --timeout={} {} {}"
            command = command.format(partial_progress_flag, REQUEST_TIMEOUT, q(from_url), q(to_path))
        else:
            command = "curl {} --output {}".format(q(http_url), q(to_path))
        
        try:
            sbp.check_call(command, shell=True) 
            returncode = 0
        except sbp.CalledProcessError as err:
            returncode = err.returncode
            retries -= 1
    return returncode == 0


def fetch_table_tsv_gz(organism, track_name, gz_file, retries=3, table_name=None, max_size=None):
    """
    Fetches a track's table from UCSC as a gzipped TSV file. If the table is shared by chrom, automatically
    concatenates the shards together so the resulting .gz can be gunzipped into a single TSV file.
    """
    url = cfg.downloads_table_tsv() % (organism, table_name if table_name else track_name)
    gz_dir = os.path.dirname(gz_file)
    basename = os.path.basename(gz_file)
    
    first_chrom = first_chrom_name(organism)
    chrom_sizes = chrom_sizes_as_odict(organism)
    if first_chrom is None or chrom_sizes is None: return False
    
    url_all_prefix = cfg.downloads_table_tsv() % (organism, "all_" + track_name)
    url_first_chrom = cfg.downloads_table_tsv() % (organism, first_chrom + "_" + track_name)
    
    if not url_exists(url):
        if url_exists(url_all_prefix):
            return rsync_or_curl(url_all_prefix, gz_file, retries=retries, max_size=max_size)
        elif url_exists(url_first_chrom):
            gz_shards = []
            gz_total_size = 0
            for chrom in sorted(chrom_sizes.keys()):
                chr_url = cfg.downloads_table_tsv() % (organism, chrom + "_" + track_name)
                if not url_exists(chr_url): continue  # Not every chrom will have a shard in every track
                if not rsync_or_curl(chr_url, gz_dir + '/' + chrom + '_' + basename, retries):
                    return False
                gz_shards.append(gz_dir + '/' + chrom + '_' + basename)
                gz_total_size += os.stat(gz_dir + '/' + chrom + '_' + basename).st_size
                if max_size is not None and gz_total_size > max_size:
                    log.warn("Table data for %s exceeded max_size %i", track_name, max_size)
                    return False
            try:
                command = "cat " + (" ".join(map(q, gz_shards))) + " > " + q(gz_file) 
                sbp.check_call(command, shell=True) 
                for gz_shard in gz_shards: os.unlink(gz_shard)
                return True
            except sbp.CalledProcessError as err:
                return False
        else:
            log.warning("No downloadable tables exist for %s", track_name)
            return False
    else:
        return rsync_or_curl(url, gz_file, retries=retries, max_size=max_size)
    

def fetch_bed_table(xcur, organism, track_name, table_name, track_type):
    """
    Fetches a table from UCSC as a gzipped TSV file, then converts this to a BED file.
    Certain BED-like formats require additional postprocessing to become the best possible BED file.
    """
    gz_file = './{}/build/{}.txt.gz'.format(organism, track_name)
    crc32_file = gz_file + '.crc32'
    prev_crc32 = None
    location = './{}/build/{}.bed'.format(organism, track_name)
    table_fields = fetch_table_fields(xcur, table_name)
    has_bin_column = table_fields[0] == 'bin'
    cut_bin_column = '| cut -f 2- ' if has_bin_column else ''
    has_genePred_fields = table_fields[-4:] == ['name2', 'cdsStartStat', 'cdsEndStat', 'exonFrames']

    # Download the table in gzipped TSV format to gz_file (using rsync to enable fast resuming)
    if not fetch_table_tsv_gz(organism, track_name, gz_file, table_name=table_name, max_size=MAX_TSV_GZ_SIZE):
        log.warning('[db %s] FAILED: Couldn\'t download .txt.gz for track "%s"', organism, track_name)
        return (None, None)

    # If the BED was previously built successfully, and the CRC32 of the gz_file hasn't changed, and we aren't
    # forcing a resort of the BED file, we can skip rebuilding the BED file and just return what we have.
    if os.path.isfile(crc32_file):
        with open(crc32_file, 'r') as f: prev_crc32 = f.read().strip()
    if os.path.isfile(location) and prev_crc32 and crc32_of_file(gz_file) == prev_crc32:
        return (location, gz_file)
    if os.path.isfile(crc32_file): os.unlink(crc32_file)

    # Otherwise, start building the BED file from the gz_file, which depends on the BED subformat.
    log.debug('[db %s] Building BED file(s) for "%s", type %s', organism, track_name, track_type[0])
    if track_type[0] == 'genePred':
        # See https://genome.ucsc.edu/goldenPath/help/bigGenePred.html which explains what we're doing here
        awk_script = """
        {
          split($11, chromEnds, ",")
          split($10, chromStarts, ",")
          for (i = 1; i <= $9; i++) {
              exonSizes[i] = chromEnds[i] - chromStarts[i]
              exonStarts[i] = chromStarts[i] - $5
          }
          blockSizes = exonSizes[1]
          blockStarts = exonStarts[1]
          blankExonFrames = "-1"
          for (i = 2; i <= $9; i++) {
              blockSizes = blockSizes "," exonSizes[i]
              blockStarts = blockStarts "," exonStarts[i]
              blankExonFrames = blankExonFrames ",-1"
          }
          print ($3, $5, $6, $2, $12 + 0, $4, $7, $8, "0", $9, blockSizes, blockStarts,
              %s, "", "", "", "")
        }
        """
        if not has_bin_column:
            awk_script = re.sub(r'\$(\d+)\b', lambda m: '$' + str(int(m.group(1)) - 1), awk_script)
        if has_genePred_fields:
            col_vars = '$' + (", $".join(map(str, range(len(table_fields) - 3, len(table_fields) + 1))))
            awk_script = awk_script.replace('%s', col_vars)
        else:
            awk_script = awk_script.replace('%s', '"", "unk", "unk", blankExonFrames')
        command = pv() + "{} | zcat | awk -v OFS=\"\\t\" -F $'\t' '{}' | sort -k1,1 -k2,2n >{}"
        command = command.format(q(gz_file), awk_script, q(location))
        
    elif track_type[0] == 'rmsk':
        awk_script = """
        {
          score = 1000 - $3 - $4 - $5
          print ($6, $7, $8, $11, score < 0 ? 0 : score, $10, $12, $13, $3 / 10, $4 / 10, $5 / 10, $2)
        }
        """
        if not has_bin_column:
            awk_script = re.sub(r'\$(\d+)\b', lambda m: '$' + str(int(m.group(1)) - 1), awk_script)
        command = pv() + "{} | zcat | awk -v OFS=\"\\t\" -F $'\t' '{}' | sort -k1,1 -k2,2n >{}"
        command = command.format(q(gz_file), awk_script, q(location))
        
    elif track_type[0] == 'psl':
        # See https://genome.ucsc.edu/goldenPath/help/bigPsl.html
        if not cmd_exists('pslToBigPsl'):
            log.critical('Must have pslToBigPsl installed on $PATH. Exiting.')
            sys.exit(67)
        awk_script = ''
        if len(track_type) > 1 and track_type[1] == 'xeno':
            # Special carve-out for the "xeno" PSL subtype, which seems to require different math on certain columns
            awk_script = """
            {
              blockSizes = $11
              blockStarts = $12
              if ($15 == "-") {
                  split($11, revExonSizes, ",")
                  split($12, revExonStarts, ",")
                  for (i = 1; i <= $10; i++) {
                      exonSizes[i] = revExonSizes[$10 - i + 1]
                      exonStarts[i] = $20 - ($2 + revExonStarts[$10 - i + 1]) - exonSizes[i] - $2
                  }
                  blockSizes = exonSizes[1]
                  blockStarts = exonStarts[1]
                  for (i = 2; i <= $10; i++) {
                      blockSizes = blockSizes "," exonSizes[i]
                      blockStarts = blockStarts "," exonStarts[i]
                  }
              }
              print ($1, $2, $3, $4, $5, $15, $7, $8, $9, $10, blockSizes, blockStarts, $13, $14, $6, 
                  $16, $17, $18, $19, $20, $21, $22, $23, $24)
            }
            """
            awk_cmd = "| awk -v OFS=\"\\t\" -F $'\t' '{}'".format(awk_script)
        command = pv() + "{} | zcat {}| pslToBigPsl /dev/stdin stdout {}| sort -k1,1 -k2,2n >{}"
        command = command.format(q(gz_file), cut_bin_column, awk_cmd, q(location))
    
    elif track_type[0] == 'chain':
        # See https://genome.ucsc.edu/goldenpath/help/bigChain.html
        # chain tracks require the *Link table to also be downloaded.
        # the file suffix here looks a little silly but it makes for simpler downstream cleanup
        link_gz_file = './{}/build/{}.txt.gz.link.txt.gz'.format(organism, track_name)
        if not fetch_table_tsv_gz(organism, track_name + 'Link', link_gz_file, max_size=MAX_TSV_GZ_SIZE):
            log.warning('[db %s] FAILED: Couldn\'t download ...link.txt.gz for chain track "%s"', organism, track_name)
            return (None, None)
        
        # first, convert the chain table to bigChain
        awk_script = "{ print ($2, $4, $5, $11, 1000, $8, $3, $6, $7, $9, $10, $1) }"
        command = pv() + "{} | zcat {}| awk -v OFS=\"\\t\" -F $'\t' '{}' >{}"
        command = command.format(q(gz_file), cut_bin_column, awk_script, q(location))
        
        # then, convert the link table to bigLink. Oddly link tables need to be sorted, but chain tables often don't
        link_table_fields = fetch_table_fields(xcur, table_name + 'Link')
        link_cut_bin_column = '| cut -f 2- ' if link_table_fields[0] == 'bin' else ''
        awk_script = "{ print ($1, $2, $3, $5, $4) }"
        command2 = " && {}{} | zcat {}| awk -v OFS=\"\\t\" -F $'\t' '{}' | sort -k1,1 -k2,2n >{}"
        command += command2.format(pv(), q(link_gz_file), link_cut_bin_column, awk_script, q(location + '.link.bed'))
    
    elif track_type[0] in BEDLIKE_FORMATS:
        command = pv() + "{} | zcat {}| sort -k1,1 -k2,2n >{}".format(q(gz_file), cut_bin_column, q(location))
        
    else:
        log.warning('[db %s] FAILED: Converting "%s" type %s to BED unhandled.', organism, track_name, bedlike_format)
        return (None, None)
    
    try:
        sbp.check_call(command, shell=True)
        if track_name == 'knownGene': location = augment_knownGene_bed_file(organism, location)
        log.info('[db %s] Fetched "%s" into a BED file', organism, track_name)
        with open(crc32_file, 'w') as f: f.write(crc32_of_file(gz_file))
    except sbp.CalledProcessError:
        log.warning('[db %s] FAILED: Couldn\'t fetch "%s" as a BED file', organism, track_name)
        log.debug('Used command: %s', command)
        return (None, None)
    
    return (location, gz_file)


def deferred_first_item_from_bigbed(bb_location):
    """
    Returns a getter for a bigBed file that returns the first row of data (if available in <30 seconds)
    """
    if not cmd_exists('bigBedToBed'):
        log.critical("Must have bigBedToBed installed on $PATH. Exiting.")
        sys.exit(68)
    
    def get_sample_item():
        command = "bigBedToBed {} -maxItems=10 /dev/stdout | head -n 1".format(q(bb_location))
        try:
            proc = sbp.Popen(command, shell=True, stdout=sbp.PIPE)
            stdout, stderr = proc.communicate(timeout=REQUEST_TIMEOUT)
            stdout = stdout.rstrip()
            try: return tuple(stdout.decode().split("\t"))
            except UnicodeDecodeError: return tuple(stdout.decode('latin-1').split("\t"))
        except (sbp.CalledProcessError, sbp.TimeoutExpired) as e:
            proc.kill()
            log.warning('Couldn\'t fetch first item from bigBed file "%s"', bb_location)
        return None

    return get_sample_item


def augment_knownGene_bed_file(organism, bed_file):
    """
    knownGene tracks, which are very high priority, unfortunately have things in a slightly different format.
    We must get `name2` from the kgXref table, and `cdsStartStat`, `cdsEndStat` and `exonFrames` from the knownCds table.
    We can also get the itemRgb from the kgColor table.
    Furthermore, we stuff the `description` field from kgXref into the 19th standard bigGenePred column (geneName2).
    """
    log.debug('[db %s] Augmenting knownGene table', organism)
    kgXref_gz_file = './{}/build/kgXref.txt.gz'.format(organism)
    kgColor_gz_file = './{}/build/kgColor.txt.gz'.format(organism)
    knownCds_gz_file = './{}/build/knownCds.txt.gz'.format(organism)
    kgXref = dict()
    kgColor = dict()
    knownCds = dict()
    
    if not fetch_table_tsv_gz(organism, 'kgXref', kgXref_gz_file):
        log.warning('[db %s] knownGene augmentation: can\'t download .txt.gz for table "kgXref"', organism)
    elif not fetch_table_tsv_gz(organism, 'kgColor', kgColor_gz_file):
        log.debug('[db %s] knownGene augmentation: doesn\'t have a table "kgColor"', organism)
    elif not fetch_table_tsv_gz(organism, 'knownCds', knownCds_gz_file):
        log.debug('[db %s] knownGene augmentation: doesn\'t have a table "knownCds"', organism)
        
    with gzip.open(kgXref_gz_file, 'rt', newline="\n") as kgXref_handle:
        for line in kgXref_handle:
            fields = line.strip("\n").split("\t")
            kgXref[fields[0]] = (fields[4], re.sub(r'[\t\r\n]', ' ', fields[7]))

    # Not every genome has a kgColor table
    if os.path.isfile(kgColor_gz_file):    
        with gzip.open(kgColor_gz_file, 'rt', newline="\n") as kgColor_handle:
            for line in kgColor_handle:
                fields = line.strip("\n").split("\t")
                kgColor[fields[0]] = ",".join(map(str, fields[1:4]))
    
    # Not every genome has a knownCds table (most don't)
    if os.path.isfile(knownCds_gz_file):
        with gzip.open(knownCds_gz_file, 'rt', newline="\n") as knownCds_handle:
            for line in knownCds_handle:
                fields = line.strip("\n").split("\t")
                knownCds[fields[0]] = (fields[1], fields[2], fields[4])
    
    with fileinput.input(bed_file, inplace=True) as f:
        for line in f:
            fields = line.strip("\n").split("\t")
            name = fields[3]
            if name in kgXref:
                fields[12] = kgXref[name][0]
                fields[18] = kgXref[name][1]
            if name in kgColor:
                fields[8] = kgColor[name]
            if name in knownCds:
                fields[13:16] = knownCds[name]
            print("\t".join(fields))
            
    if os.path.isfile(kgXref_gz_file): os.remove(kgXref_gz_file)
    if os.path.isfile(kgColor_gz_file): os.remove(kgColor_gz_file)
    if os.path.isfile(knownCds_gz_file): os.remove(knownCds_gz_file)
    return bed_file


def extract_bed_plus_fields(track_type=None, as_location=None, as_string=None, bigbed_location=None):
    """
    Extracts the bedPlus field names either from a `track_type` (e.g. "bed6+3") + autoSql file location or string,
    or a bigBed file (if `bigbed_location` is provided, which takes precedence over the other arguments).
    """
    num_standard_fields = 12
    as_parsed = None
    
    if bigbed_location is not None:
        num_standard_fields, _ = get_bed_type_for_bigbed(bigbed_location)
        as_string = fetch_autosql_for_bigbed(bigbed_location)
        if as_string is None:
            log.warning('Couldn\'t retrieve autoSql from bigBed: %s', bigbed_location)
            return None
    elif track_type is not None:
        track_type = re.split(r'\s+', track_type)
        try: _, bed_type = get_as_and_bed_type_for_bedlike_format(track_type[0])
        except KeyError: bed_type = None        
        if bed_type is not None:
            num_standard_fields = int(re.search(r'\d+', bed_type).group(0))
        elif len(track_type) > 1 and re.match(r'^\d+$', track_type[1]):
            num_standard_fields = int(track_type[1])
    else: raise ValueError("Either `track_type` or `bigbed_location` must be not None")
    
    if as_string is None:
        with open(as_location, 'r') as f:
            as_string = f.read()
    
    try:
        as_parsed = AutoSqlDeclaration(as_string)
    except Exception as e:
        exc = ''.join(traceback.format_exception(*sys.exc_info()))
        log.warning('Can\'t parse autoSql file: %s\n%s', as_location or as_string, exc)
        return None
    
    field_names = list(as_parsed.field_comments.keys())
    return field_names[num_standard_fields:]


def generate_bigbed(organism, bed_type, as_file, bed_file, bed_plus_fields=None, no_id=False, bb_file=None):
    """
    Generates BigBed file. Make sure you have 'bedToBigBed' and 'bigBedInfo' in your $PATH
    """
    if not cmd_exists('bedToBigBed') or not cmd_exists('bigBedInfo'):
        log.critical("Must have bedToBigBed and bigBedInfo installed on $PATH. Exiting.")
        sys.exit(69)
    
    if bb_file is None:
        bb_file = organism + '/bigBed/' + os.path.basename(bed_file)[:-4] + '.bb'
    chrom_sizes_file = fetch_chrom_sizes(organism)
    if chrom_sizes_file is None: return None
    
    bed_file_size = os.path.getsize(bed_file)
    num_cols = re.search(r'\d+', bed_type)
    indexable_fields = ['name'] if int(num_cols.group(0) if num_cols else 0) >= 4 else []
    whitelist = ['name2'] if no_id else ['name2', 'id']
    if bed_plus_fields is not None:
        indexable_fields += [field for field in bed_plus_fields if field in whitelist]

    extra_index_opt = ''
    if len(indexable_fields) > 0 and bed_file_size < MAX_INDEXABLE_BED_SIZE:
        extra_index_opt = '-extraIndex={}'.format(q(",".join(indexable_fields)))

    command = 'bedToBigBed -type={} -as={} {} -tab {} {} {}'
    command = command.format(q(bed_type), q(as_file), extra_index_opt, q(bed_file), q(chrom_sizes_file), q(bb_file))
    try:
        sbp.check_call(command, shell=True)
        sbp.check_call('bigBedInfo {} 2>&1 >/dev/null'.format(q(bb_file)), shell=True)
        log.info('[db %s] SUCCESS: Constructed "%s" bigBed file', organism, bb_file)
    except sbp.CalledProcessError:
        log.warning('[db %s] FAILED: Couldn\'t construct "%s" bigBed file', organism, bb_file)
        log.debug('Used command: %s', command)
        if os.path.isfile(bb_file): os.remove(bb_file)  # Delete any incompletely generated bigBed files
        return None

    return bb_file


def generate_biglink(organism, bed_file):
    """
    bigChain tracks need a bigLink file (another bigBed format) to display properly
    For more info, see: https://genome.ucsc.edu/goldenpath/help/bigChain.html
    """
    as_location = os.path.join(SCRIPT_DIRECTORY, 'autosql/bigLink.as')
    bed_type = 'bed4+1'
    bed_plus_fields = ['qStart']
    bb_file = organism + '/bigBed/' + os.path.basename(bed_file)[:-4] + '.link.bb'
    return generate_bigbed(organism, bed_type, as_location, bed_file + '.link.bed', bed_plus_fields, bb_file=bb_file)


def test_default_remote_item_url(organism, table_name, sample_item):
    """
    If a track/table doesn't have a `url` setting, it may simply link to the default UCSC item pages
    which have URLs of the form:
        https://genome.ucsc.edu/cgi-bin/hgc?db=hg38&c=chr9&o=133186402&t=&l=&r=&g=est&i=BI003541
    This function checks if a page exists for a sample item and seems valid, returning True/False
    """
    if not sample_item or len(sample_item) < 4: return False
    
    # these correspond to $D, $S, ${, $}, ${, $}, $T, and $$ respectively for the `url` placeholder scheme on
    # https://genome.ucsc.edu/goldenpath/help/trackDb/trackDbHub.html#commonSettings
    fields = (organism, sample_item[0], sample_item[1], sample_item[2], sample_item[1], 
                sample_item[2], table_name, sample_item[3])
    
    try:
        response = urllib.request.urlopen(cfg.remote_item_url() % fields, timeout=REQUEST_TIMEOUT)
        html = response.read()
    except URLError as e:
        return False
    
    # If the page exists and doesn't contain any UCSC error box codes,,,
    no_errors = html.find(b";warnList.innerHTML +=") == -1 and html.find(b"<!-- HGERROR-START -->") == -1 and \
                re.search(b"No item.{1,500}starting at", html) is None and html.find(b"Error 404") == -1
    # and it seems to have a content table, we consider it's a valid item page.
    return no_errors and html.find(b"subheadingBar") >= 0


def find_bw_location_for_wig(organism, track_name):
    """
    Try to find a bigwig file on http://hgdownload.cse.ucsc.edu/goldenPath/ that corresponds to this wig track
    """
    file_location = cfg.wig_as_bigwig() % (organism, track_name, organism, track_name)
    
    if not url_exists(file_location):
        # Admittedly this hack was built entirely for phastCons100Way in hg19. Not sure if worth it.
        # FIXME: For http://hgdownload.cse.ucsc.edu/goldenPath/hg19/phyloP100way/ need to search for *.bw link on index page.
        first_digit = re.search('\\d', track_name)
        if first_digit is not None:
            inverted_name = track_name[first_digit.start():] + '.' + track_name[0:first_digit.start()]
            file_location = cfg.wig_as_bigwig() % (organism, track_name, organism, inverted_name)
        if first_digit is None or not url_exists(file_location):
            log.debug('[db %s] wig track "%s" was not found as a bigWig at URL: %s', organism, track_name, file_location)
            return None

    return file_location


def fetch_wib_files(xcur, organism, track_name, table_name):
    """
    Downloads all .wib files (binary wiggle data) for a "wig" track
    """
    build_dir = './{}/build/'.format(organism)
    filenames = [row[0] for row in qups(("SELECT DISTINCT file FROM {}").format(table_name), xcur)]
    for filename in filenames:
        url = cfg.downloads_wib() % filename
        if not rsync_or_curl(url, build_dir + os.path.basename(filename), retries=3):
            log.warning("[db %s] Could not fetch wib file (track %s): %s", organism, track_name, filename)
            return None
    return [build_dir + os.path.basename(filename) for filename in filenames]


def generate_bigwig(organism, track_name, table_name, bw_file=None):
    """
    Uses the `hgWiggle`, `wigToBigWig`, and `bigWigInfo` tools (must be in $PATH) to convert a wig table to bigWig
    For an introduction to `hgWiggle`, see http://genomewiki.ucsc.edu/index.php/Using_hgWiggle_without_a_database
    """
    if not cmd_exists('hgWiggle') or not cmd_exists('wigToBigWig') or not cmd_exists('bigWigInfo'):
        log.critical("Must have hgWiggle, wigToBigWig, and bigWigInfo installed on $PATH. Exiting.")
        sys.exit(75)
    
    chrom_sizes_file = fetch_chrom_sizes(organism)
    if chrom_sizes_file is None: return None
    if bw_file is None: bw_file = organism + '/bigWig/' + track_name + '.bw'
    
    data_dir = os.getcwd()
    bw_file_abs = os.path.abspath(bw_file)
    ensure_hg_conf(data_dir)
    command = "HOME={} hgWiggle -db={} -lift=1 {} | pv | wigToBigWig -clip /dev/stdin {} {}"
    command = command.format(q(data_dir), q(organism), q(table_name), 
                             q(os.path.abspath(chrom_sizes_file)), q(bw_file_abs))
    
    #TODO: handle the situation where the .wib file contains multiple data for the same location, in which case
    #      wigToBigWig produces an error "Overlap on chrX between items starting at..." (happens for hg18.phastCons*)
    #      One solution: a .wig filtering script that uses a bitarray for genome coverage and drops conflicting data
    try:
        os.chdir(organism + '/build')
        sbp.check_call(command, shell=True)
        sbp.check_call('bigWigInfo {} 2>&1 >/dev/null'.format(q(bw_file_abs)), shell=True)
        log.info('[db %s] SUCCESS: Constructed "%s" bigWig file', organism, bw_file)
    except sbp.CalledProcessError:
        log.warning('[db %s] FAILED: Couldn\'t construct "%s" bigWig file', organism, bw_file)
        log.debug('Used command: %s', command)
        if os.path.isfile(bw_file_abs): os.remove(bw_file_abs)  # Delete any incompletely generated bigWig files
        bw_file = None
    finally:
        os.chdir(data_dir)
        
    return bw_file


def translate_settings(xcur, organism, track_name, parent_track, is_composite_track, get_sample_item, old_settings, 
                       bed_plus_fields=None, url=None):
    """
    Translates the settings field in UCSC's trackDb into a JSON-encoded object with track settings supported by chromozoom
    """
    whitelisted_keys = ['autoScale', 'altColor', 'alwaysZero', 'color', 'colorByStrand', 'container', 'itemRgb', 
                        'maxHeightPixels', 'url', 'useScore', 'viewLimits', 'windowingFunction']
    new_settings = dict()

    if 'superTrack' in old_settings:
        super_track_pieces = re.split(r'\s+', old_settings['superTrack'])
        new_settings['visibility'] = 'hide' if super_track_pieces[-1] == 'off' else 'show'
    
    if 'parent' in old_settings:
        parent_pieces = old_settings['parent'].split()
        new_settings['visibility'] = 'hide' if parent_pieces[-1] == 'off' else 'show'
        # Inherit settings from a parent trackDb View, if it exists
        # See: https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html#Composite_-_Views_Settings
        # We need to forcibly merge these into new_settings because we don't save View trackDb entries to tracks.db
        if parent_pieces[0] != parent_track:
            view_settings = fetch_view_settings(xcur, parent_pieces[0], parent_track)
            if view_settings is not None:
                if view_settings.get('visibility') == 'hide':
                    new_settings['visibility'] = 'hide'
                view_settings.update(old_settings)
                old_settings = view_settings
    
    # Copy trackDb settings into an acceptable chromozoom settings object using our whitelist of keys
    for key, value in old_settings.items():
        if key in whitelisted_keys:
            new_settings[key] = value
    
    # Implement trackDb subgroups
    # See: https://genome.ucsc.edu/goldenPath/help/trackDb/trackDbHub.html#Composite_-_Subgroups_Settings
    if 'subGroups' in old_settings and not is_composite_track:
        new_settings['tags'] = dict([keyval.split('=') for keyval in re.split(r'\s+', old_settings['subGroups'])])
    if is_composite_track and 'subGroup1' in old_settings:
        new_settings['tagging'] = {}
        for key in ['subGroup' + str(i) for i in range(1, 9)]:
            if key in old_settings:
                pieces = re.split(r'\s+', old_settings[key])
                new_settings['tagging'][pieces[0]] = {"desc": pieces[1]}
                new_settings['tagging'][pieces[0]]["vals"] = dict([keyval.split("=", 1) for keyval in pieces[2:]])
    
    # special exception for knownGene
    if track_name == 'knownGene': new_settings['itemRgb'] = 'on'
    # special exception for rmsk. TODO: once 
    if track_name == 'rmsk': new_settings['useScore'] = 1
    # special exception for bigChain tracks, which need a linkDataUrl pointing to the bigLink file
    if 'type' in old_settings and re.match(r'^chain\s+', old_settings['type']):
        new_settings['linkDataUrl'] = organism + '/bigBed/' + track_name + '.link.bb'
    # save bedPlusFields parsed from the autoSql file
    if bed_plus_fields is not None: new_settings['bedPlusFields'] = ",".join(bed_plus_fields)
    
    # Try to find the most palatable `url` setting for chromozoom, based on all the possible candidates saved in UCSC
    if 'directUrl' in old_settings: new_settings['url'] = old_settings['directUrl']
    elif url: new_settings['url'] = url.decode('latin1')
    if 'url' in new_settings and not re.match(r'^https?://', new_settings['url']):
        new_settings['url'] = cfg.ucsc_base_url() + re.sub(r'^/+', '', new_settings['url'])
    # As per the `url` specification in https://genome.ucsc.edu/goldenpath/help/trackDb/trackDbHub.html#commonSettings
    # inserting these placeholders into the URL tells chromozoom to substitute the corresponding info for each item.
    # https://genome.ucsc.edu/cgi-bin/hgc?db=$D&c=$S&l=${&r=$}&o=${&t=$}&g=$T&i=$$
    if 'url' not in new_settings:
        if callable(get_sample_item) and test_default_remote_item_url(organism, track_name, get_sample_item()):
            new_settings['url'] = cfg.remote_item_url() % ('$D', '$S', '${', '$}', '${', '$}', track_name, '$$')
    
    return json.dumps(new_settings)


def save_to_local_database(organism, localconn, row_vals, children = []):
    """
    Saves row_vals to the tracks table in the local SQLite database, and updates parentTrack on children, if provided
    """
    query = 'INSERT OR REPLACE INTO tracks VALUES (' + (','.join(['?'] * len(row_vals))) + ')'
    localconn.execute(query, row_vals)
    track_name = row_vals[0]
    log.info('[db %s] Saved local database entry for track "%s"', organism, track_name)
    
    # Ensure child tracks of super tracks have parentTrack set correctly.
    for child_track_name in children:
        log.info('[db %s] Also updated parentTrack on child "%s" for supertrack "%s"', 
                 organism, child_track_name, track_name)
        localconn.execute('UPDATE tracks SET parentTrack = ? WHERE name = ?', (track_name, child_track_name))
    
    localconn.commit()


def delete_from_local_database(organism, localconn, track_name):
    """
    Deletes a track from the tracks table in the local SQLite database
    """
    cursor = localconn.cursor()
    cursor.execute('DELETE FROM tracks WHERE name = ?', (track_name,))
    if cursor.rowcount > 0: log.info('[db %s] DELETED local database entry for track "%s"', organism, track_name)
    localconn.commit()


def deprioritize_empty_parent_tracks(organism, localconn):
    """
    If a super or composite track doesn't actually contain any real tracks, deprioritize to 999999
    """
    query = '''SELECT name FROM tracks AS t1 WHERE
                    t1.compositeTrack = 1 AND
                    t1.type {} 'supertrack' AND
                    (SELECT COUNT(*) FROM tracks as t2 WHERE 
                        t2.parentTrack = t1.name AND t2.name != t1.name {}) == 0'''
    empty_composite_tracks = [row[0] for row in localconn.execute(query.format('!=', '')).fetchall()]
    for track_name in empty_composite_tracks:
        log.info('[db %s] Setting composite track "%s" priority=999999 (no children)', organism, track_name)
        localconn.execute('UPDATE tracks SET priority = 999999 WHERE name = ?', (track_name,))
    
    extra_clause = ' AND name NOT IN (' + (','.join(['?'] * len(empty_composite_tracks))) + ')'
    empty_supertracks = [row[0] for row in 
                         localconn.execute(query.format('==', extra_clause), empty_composite_tracks).fetchall()]
    for track_name in empty_supertracks:
        log.info('[db %s] Setting supertrack "%s" priority=999999 (no non-empty children)', organism, track_name)
        localconn.execute('UPDATE tracks SET priority = 999999 WHERE name = ?', (track_name,))
    
    localconn.commit()
