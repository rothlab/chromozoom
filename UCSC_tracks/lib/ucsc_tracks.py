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
from .autosql import AutoSqlDeclaration

SCRIPT_DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Cache the parsed config file after the first access
config_yaml = None

BEDLIKE_FORMATS = {
    # format: (as_location, bed_type)
    'bed': (None, None),
    'genePred': ('autosql/genePredFull.as', 'bed12+8'),
    'psl': ('autosql/bigPsl.as', 'bed12+12'),
    'gvf': ('autosql/bigGvf.as', 'bed8+3'),
    'narrowPeak': ('autosql/bigNarrowPeak.as', 'bed6+4'),
    'rmsk' : ('autosql/bigRmsk.as', 'bed6+6')
}
# For some reason bedToBigBed fails to create an extraIndex for BED files above this
# length, roughly 27GB. Therefore, it's best to disable extraIndex'es for such large BED files.
MAX_INDEXABLE_BED_SIZE = 27000 * 1000000


class TrackInfo(dict):
    def __init__(self, *args):
        self.groups = {}
        dict.__init__(self, args)


def open_ucsc_yaml():
    global config_yaml
    if config_yaml is not None:
        return config_yaml
    try:
        import yaml
        with open(os.path.join(os.path.dirname(__file__), '../../ucsc.yaml'), 'r') as handle:
            config_yaml = yaml.load(handle)
    except (ImportError, FileNotFoundError) as e:
        sys.exit('FATAL: could not read ../ucsc.yaml.')
    return config_yaml
    

def print_time():
    """
    :return: current time string
    """
    return time.strftime('%X %x')


def crc32_of_file(file_name):
    with open(file_name, 'rb') as fh:
        hash = 0
        while True:
            s = fh.read(65536)
            if not s:
                break
            hash = zlib.crc32(s, hash)
        return "%08X" % (hash & 0xFFFFFFFF)


def create_sqllite3_db(xorganism):
    """
    Checks if DB is created and
    if not create it.
    Returns DB location.
    """
    db_loc = './{}/tracks.db'.format(xorganism)

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


def get_ucsc_base_url():
    return open_ucsc_yaml()['browser_hosts']['authoritative']

def get_remote_table():
    return get_ucsc_base_url() + open_ucsc_yaml()['browser_urls']['tables']

def get_mysql_host():
    return open_ucsc_yaml()['browser_mysql']['authoritative']

def get_downloads_base_url():
    return open_ucsc_yaml()['data_urls']['downloads']

def get_downloads_table_tsv():
    return open_ucsc_yaml()['data_urls']['table_tsv']

def get_downloads_chrom_sizes():
    return open_ucsc_yaml()['data_urls']['chrom_sizes']
    
def get_wig_as_bigwig():
    return open_ucsc_yaml()['data_urls']['wig_as_bigwig']

def get_remote_tracks():
    return get_ucsc_base_url() + open_ucsc_yaml()['browser_urls']['tracks']

def get_remote_item_url():
    return get_ucsc_base_url() + open_ucsc_yaml()['browser_urls']['item_detail']


def cmd_exists(cmd):
    """
    Check if a given executable is on $PATH
    For more on the `type` shell builtin, see https://bash.cyberciti.biz/guide/Type_command
    """
    return sbp.call("type " + cmd, shell=True, stdout=sbp.PIPE, stderr=sbp.PIPE) == 0

def url_exists(url):
    req = urllib.request.Request(url, method="HEAD")
    try:
        urllib.request.urlopen(req)
    except URLError:
        return False
    return True

def qups(in_cmd, ucur):
    """
    Executes MySQL query and returns parsed results
    """
    ucur.connection.ping(reconnect=True)
    ucur.execute(in_cmd)
    return ucur.fetchall()


def connect_to_ucsc_mysql(host, db):
    try:
        conn = pymysql.connect(host=host, user='genome', database=db)
        return conn.cursor()
    except pymysql.err.InternalError:
        print('WARNING ({}): No MySQL tables found for "{}". Omitting.'.format(print_time(), organism))
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


def get_last_remote_updates(xcur, db, table_names):
    """
    Fetches table update times
    """
    in_clause = ','.join(['"' + table_name + '"' for table_name in table_names])
    result = qups(("SELECT TABLE_NAME, UPDATE_TIME FROM information_schema.tables "
                   "WHERE TABLE_SCHEMA='{}' AND TABLE_NAME IN ({})").format(db, in_clause), xcur)
    return dict([(row[0], str(row[1])) for row in result])


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


def get_organisms_list(host='', prefix=None):
    """
    Get list of organism databases that we may want to scrape from UCSC
    """
    prefix_query = ""
    if prefix is not None:
        prefix_query = " AND name LIKE '{}%'".format(prefix)
    try:
        conn = pymysql.connect(host=host, user='genome', database='hgcentral')
        xcur = conn.cursor()
    except pymysql.err.InternalError:
        print('FATAL ({}): Could not connect to UCSC MySQL server at "{}".'.format(print_time(), host))
        sys.exit(1)
    
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
    track_form = mytree.xpath('//form[@id="TrackForm"]')[0]
    gene_tracks = track_form.xpath('//tr[starts-with(@id,"genes-")]//select/@name')
    priorities = {}
    if len(gene_tracks) == 0:
        sys.exit("FATAL: Cannot parse browser page for {} to determine track priorities".format(db))
    
    for track in selection:
        sel_name = re.sub(r'^all_', '', track)
        parent_track = track_info[track]['parentTrack']
        track_default_visibility = track_form.xpath('//select[@name="{}"]/option[@selected]/text()'.format(sel_name))
        parent_default_visibility = track_form.xpath('//select[@name="{}"]/option[@selected]/text()'.format(parent_track))
        if track == gene_tracks[0] or track in special_high_priority:
            priorities[track] = 1
        elif len(track_default_visibility) > 0 and track_default_visibility[0] != 'hide':
            priorities[track] = 10
        elif len(parent_default_visibility) > 0 and parent_default_visibility[0] != 'hide':
            priorities[track] = 30
        else:
            priorities[track] = 100
        
        if parent_track != sel_name:
            # Composite track subtracks incur additional penalty proportional to number of subtracks
            num_subtracks = len([k for (k, v) in track_info.items() if v['parentTrack'] == parent_track])
            penalty = 3 if num_subtracks > 10 else (2 if num_subtracks > 3 else 0.5)
            priorities[track] = int(priorities[track] * penalty)
        
    return priorities
    

def create_hierarchy(organism, table_source):
    """
    Creates a file with tables hierarchy for a given organism.
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
        simple_table = [table for table in [curr_track, "all_" + curr_track] if table in curr_track_tables]
        if len(simple_table) == 1:
            selected_tracks.append(simple_table[0])
            track_info[simple_table[0]] = {
                'displayName': line.split('(', 1)[1][:-2],
                'trackLabel': curr_trackname,
                'groupLabel': curr_tgroupname,
                'parentTrack': curr_track
            }
        else:
            # Complex track
            if include_composite_tracks:
                selected_tracks.append(curr_track)
                track_info[curr_track] = {
                    'displayName': line.split('(', 1)[1][:-2],
                    'trackLabel': curr_trackname,
                    'groupLabel': curr_tgroupname,
                    'parentTrack': curr_track
                }
                selected_tracks += curr_track_tables
                for table in curr_track_tables:
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


def filter_to_existing_tables(wanted_tracks, xcur):
    """
    Checks which tracks in wanted_tracks can be extracted from UCSC databases, returns a filtered list
    """
    track_data = set([table[0] for table in qups("SELECT tableName FROM trackDb", xcur)])
    # Allow some tables, like mrna, and est, to by prefixed by "all_"
    track_data = track_data | set(["all_" + track for track in track_data])
    tracks_tables = set([table[0] for table in qups("SHOW TABLES", xcur)])
    extractable = track_data & tracks_tables & set(wanted_tracks)
    return extractable


def filter_tracks_by_args(selected_tracks, args, track_priority):
    """
    Applies --priority_below, --track_prefix, and --skip_tracks filters to a list of track names
    """
    if args.priority_below is not None:
        selected_tracks = [t for t in selected_tracks if track_priority[t] <= args.priority_below]
    if args.track_prefix is not None:
        selected_tracks = [t for t in selected_tracks if t.startswith(args.track_prefix)]
    if args.skip_tracks is not None:
        selected_tracks = [t for t in selected_tracks if not t.startswith(args.skip_tracks)]
    return selected_tracks


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
                  "FROM trackDb WHERE settings REGEXP '\\nsuperTrack on[ [.newline.]]' ORDER BY tableName", xcur)
    
    tracks = [list(track) for track in tracks]
    for track in tracks:
        track[1] = 'supertrack'
        track_info[track[0]] = {
            'displayName': track[3],
            'trackLabel': track[3],
            'groupLabel': track_info.groups[track[2]],
            'parentTrack': track[0]
        }
        children = qups(("SELECT tableName FROM trackDb WHERE settings REGEXP '\\nsuperTrack {}[ [.newline.]]'"
                         " OR settings REGEXP '\\nparent {}[ [.newline.]]'").format(track[0], track[0]), xcur)
        track.append([child[0] for child in children])
    
    return tracks


def fetch_view_settings(xcur, view_track_name, parent_track):
    tracks = qups(("SELECT settings FROM trackDb WHERE tableName = \"{}\"").format(view_track_name), xcur)
    if len(tracks) > 0:
        settings = parse_trackdb_settings(tracks[0][0])
        if 'view' in settings and 'parent' in settings and settings['parent'] == parent_track:
            return settings
        else:
            print('WARNING ({}): tried to fetch view "{}" (parent "{}") but its settings are invalid'.format(print_time(), 
                    view_track_name, parent_track))
    return None


def setup_directories(organism):
    """
    Sets up directories and files needed for track fetching for one organism
    """

    # Build directory
    if not os.path.exists(organism):
        os.makedirs(organism)

    if not os.path.exists(organism + '/build'):
        os.makedirs(organism + '/build')

    if not os.path.exists(organism + '/bigBed'):
        os.makedirs(organism + '/bigBed')


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
    If so, returns the location of the autoSql file for this type, and the BED subtype (bedN+N).
    (If `bed_location` is given, also copies the autoSql file alongside it so it can be potentially modified).
    Otherwise, raises a KeyError.
    """
    track_type = re.split(r'\s+', track_type)
    from_location, bed_subtype = BEDLIKE_FORMATS[track_type[0]]
    if from_location is not None and bed_location is not None:
        to_location = re.sub(r'\.bed$', '.as', bed_location)
        copyfile(os.path.join(SCRIPT_DIRECTORY, from_location), to_location)
        return to_location, bed_subtype
    return from_location, bed_subtype


def fetch_autosql_for_bigbed(bb_location):
    command = "bigBedInfo '{}'".format(bb_location)
    command_with_as = "bigBedInfo -as '{}'".format(bb_location)
    try:
        bb_info = sbp.check_output(command, shell=True)
        bb_info_with_as = sbp.check_output(command_with_as, shell=True)
        as_finder = re.compile(b'^basesCovered: ', re.MULTILINE)
        match = as_finder.search(bb_info)
        if match is None or b'as:\n' not in bb_info_with_as:
            print('WARNING ({}): Couldn\'t fetch autoSql for bigbed file at "{}"'.format(print_time(), bb_location))
            return None
        # Clips out the b"as:\n"
        return bb_info_with_as[match.start() + 4 : -len(bb_info) + match.start()].decode('latin1')
    except sbp.CalledProcessError:
        print('WARNING ({}): Couldn\'t fetch bigBedInfo for location "{}"'.format(print_time(), bb_location))
        print(command)
        return None
    return None


def fetch_as_file(bed_location, xcur, table_name):
    """
    Creates an autoSql file from UCSC's table metadata and returns its location.
    Applies a few basic cleanup operations before the autoSql file is saved.
    """
    as_file = bed_location[:-4] + '.as'
    as_contents = qups('SELECT autoSqlDef FROM tableDescriptions WHERE tableName="{}";'.format(table_name),
                      xcur)[0][0].decode('latin1').strip()
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


def get_chrom_sizes(organism):
    """
    Fetches the chrom.sizes file for a genome into a dictionary of chr => size.
    """
    chrom_sizes_file = "./{0}/build/chrom.sizes.txt".format(organism)
    chrom_sizes = dict()
    with open(chrom_sizes_file, 'r') as f:
        for line in f.read().split('\n'):
            fields = line.split()
            if len(fields) == 2: chrom_sizes[fields[0]] = int(fields[1])
    return chrom_sizes


def fix_bed_as_files(organism, bed_file, asql_file, bed_type):
    """
    Tries to fix the BED and autoSql files if initial BigBed building failed.
    
    There are several fixes applied here:
    1) Up to 9 initial fields in the autoSql are reset to default types and names used by the BED format.
    2) The remaining fields are renamed so that there are no collisions with default names.
    3) If the autoSql contains fields not in the (first line of the) BED file, these are trimmed.
    4) BED data on invalid contigs (checked against chrom.sizes.txt) are filtered out of the BED file.
    5) The 5th column in the BED file, `score`, is clipped to an integer range of 0-1000.
    
    Note that these fixes should be idempotent, i.e. there is no change if this process is run multiple times.

    This function returns a normalized BED type "bedN+N" that reflects the actual number of fields in the BED file.
    """
    # TODO: Other fixes we should implement, based on errors that occur in hg38:
    # - BED fields longer than autoSql's 'string' allows (255 bytes). Could change autoSql to 'lstring' or truncate.
    # - For bigPsl, number of elements in oChromStarts not matching blockCount (usually for blockCount >1024)

    chrom_sizes = get_chrom_sizes(organism)

    def_types = ['string', 'uint', 'uint', 'string', 'uint', 'char[1]', 'uint', 'uint', 'uint']
    def_names = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'reserved']
    bed_nums = tuple(map(int, re.findall(r'\d+', bed_type)))
    field_count = None

    for line in fileinput.input(bed_file, inplace=True):
        fields = line.strip().split('\t')
        if field_count is None: field_count = len(fields)

        # Drop any BED data that doesn't map to a valid chr (contig name)
        if fields[0] not in chrom_sizes: continue

        # Clip the 5th column in the BED file if it is being used as the standard `score` field to the range of 0-1000.
        if bed_nums[0] >= 5:
            if int(fields[4]) > 1000: fields[4] = '1000'
            if int(fields[4]) < 0: fields[4] = '0'
        
        #TODO: Tally up the max bytelength of each of the fields, if >255 can upconvert string -> lstring in the asql.

        print('\t'.join(fields))

    with open(asql_file, 'r') as f: asql_lines = re.sub(r'\n(\s*\n)+', '\n', f.read().strip()).split('\n')

    # Resets the initial fields in the autoSql that are supposed to conform to BED standards per the declared BED type
    #    i.e. a BED type of 'bed 6 +' will have the first 6 fields reset to BED standard names and types
    # This fixes bedToBigBed errors of the form "column #4 names do not match: Yours=[id]  BED Standard=[name]" 
    for dtype, dname, eline, lnum in zip(def_types, def_names, asql_lines[3:], range(3, len(asql_lines))):
        default_field = lnum < bed_nums[0] + 3
        if default_field: asql_lines[lnum] = (dtype + ' ' + eline.split(maxsplit=1)[1])
        lin1, lin2 = eline.split(';', maxsplit=1)
        lin1 = lin1.rsplit(maxsplit=1)
        # When renaming fields, have to avoid collisions with non-default fields that are named the same
        if default_field: lin1[1] = dname
        elif lin1[1] in def_names[:bed_nums[0]]: lin[1] = lin[1] + '2'
        asql_lines[lnum] = '; '.join([' '.join(lin1), lin2])

    del asql_lines[3 + field_count : -1] # remove autoSQL fields that aren't in the BED file
    open(asql_file, 'w').write('\n'.join(asql_lines))

    bed_nums = (bed_nums[0], field_count - bed_nums[0]) if field_count > bed_nums[0] else (bed_nums[0],)
    new_bed_type = "bed" + "+".join(map(str, bed_nums))
    print('INFO ({}): [db {}] Fixed AS/BED files for {} ({} -> {})'.format(
            print_time(), organism, bed_file, bed_type, new_bed_type))
    return new_bed_type


def rsync_or_curl(from_urls, to_path, retries=3):
    from_urls = [from_urls] if isinstance(from_urls, str) else from_urls
    
    returncode = None
    while returncode != 0 and retries > 0:
        from_url = from_urls[0]
        if len(from_urls) > 1: from_urls.pop(0)
        
        if cmd_exists('rsync') and from_url[0:8] == 'rsync://':
            command = "rsync -avzP --no-R --no-implied-dirs --timeout=30 '{}' '{}'".format(from_url, to_path)
        else:
            http_url = re.sub(r'^rsync://', 'http://', from_url)
            command = "curl '{}' --output '{}'".format(http_url, to_path)
        
        try:
            sbp.check_call(command, shell=True) 
            returncode = 0
        except sbp.CalledProcessError as err:
            returncode = err.returncode
            retries -= 1
    return returncode == 0


def fetch_table_tsv_gz(organism, table_name, gz_file, retries=3):
    url = get_downloads_table_tsv() % (organism, table_name)
    return rsync_or_curl(url, gz_file, retries)
    

def fetch_bed_table(xcur, table_name, organism, bedlike_format=None):
    """
    Fetches a table from UCSC as a gzipped TSV file, then converts this to a BED file.
    Certain BED-like formats require additional postprocessing to become the best possible BED file.
    """
    gz_file = './{}/build/{}.txt.gz'.format(organism, table_name)
    crc32_file = gz_file + '.crc32'
    prev_crc32 = None
    location = './{}/build/{}.bed'.format(organism, table_name)
    table_fields = fetch_table_fields(xcur, table_name)
    has_bin_column = table_fields[0] == 'bin'
    cut_bin_column = '| cut -f 2- ' if has_bin_column else ''
    has_genePred_fields = table_fields[-4:] == ['name2', 'cdsStartStat', 'cdsEndStat', 'exonFrames']

    # Download the table in gzipped TSV format to gz_file (using rsync to enable fast resuming)
    if not fetch_table_tsv_gz(organism, table_name, gz_file):
        print('FAILED ({}): [db {}] Couldn\'t download .txt.gz for table "{}".'.format(print_time(), organism, table_name))
        return (None, None)

    # If the BED was previously built successfully, and the CRC32 of the gz_file hasn't changed,
    # we can skip rebuilding the BED file and just return what we already have.
    if os.path.isfile(crc32_file):
        with open(crc32_file, 'r') as f: prev_crc32 = f.read().strip()
    if os.path.isfile(location) and prev_crc32 and crc32_of_file(gz_file) == prev_crc32:
        return (location, gz_file)
    if os.path.isfile(crc32_file): os.unlink(crc32_file)

    # Otherwise, start building the BED file from the gz_file, which depends on the BED subformat.
    if bedlike_format == 'genePred':
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
        command = "cat '{}' | zcat | awk -v OFS=\"\\t\" -F $'\t' '{}' | sort -k1,1 -k2,2n >'{}'".format(gz_file, 
                                                                                                    awk_script, location)
    elif bedlike_format == 'rmsk':
        awk_script = """
        {
          score = 1000 - $3 - $4 - $5
          print ($6, $7, $8, $11, score < 0 ? 0 : score, $10, $12, $13, $3 / 10, $4 / 10, $5 / 10, $2)
        }
        """
        if not has_bin_column:
            awk_script = re.sub(r'\$(\d+)\b', lambda m: '$' + str(int(m.group(1)) - 1), awk_script)
        command = "cat '{}' | zcat | awk -v OFS=\"\\t\" -F $'\t' '{}' | sort -k1,1 -k2,2n >'{}'".format(gz_file, 
                                                                                                    awk_script, location)
    elif bedlike_format == 'psl':
        # See https://genome.ucsc.edu/goldenPath/help/bigPsl.html
        if not cmd_exists('pslToBigPsl'):
            sys.exit("FATAL: must have pslToBigPsl installed on $PATH")
        command = "cat '{}' | zcat {}| pslToBigPsl /dev/stdin stdout | sort -k1,1 -k2,2n >'{}'".format(gz_file, 
                                                                                                  cut_bin_column, location)
    elif bedlike_format in BEDLIKE_FORMATS:
        command = "cat '{}' | zcat {}>'{}'".format(gz_file, cut_bin_column, location)
    else:
        print('FAILED ({}): [db {}] "{}" {} conversion to BED not handled.'.format(print_time(), organism, table_name, 
                                                                                   bedlike_format))
        return (None, None)
    
    try:
        sbp.check_call(command, shell=True)
        if table_name == 'knownGene':
            location = augment_knownGene_bed_file(organism, location)
        print('DONE ({}): [db {}] Fetched "{}" into a BED file'.format(print_time(), organism, table_name))
        with open(crc32_file, 'w') as f: f.write(crc32_of_file(gz_file))
    except sbp.CalledProcessError:
        print('FAILED ({}): [db {}] Couldn\'t fetch "{}" as a BED file.'.format(print_time(), organism, table_name))
        print(command)
        return (None, None)
    
    return (location, gz_file)


def get_first_item_from_bed(bed_location):
    """
    Gets the first item from the BED file at bed_location
    Returns a tuple with the various fields.
    """
    with open(bed_location, 'r') as f:
        first_line = f.readline().rstrip()
        return tuple(first_line.split("\t"))


def get_first_item_from_bigbed(bb_location):
    if not cmd_exists('bigBedToBed'):
        sys.exit("FATAL: must have bigBedToBed installed on $PATH")
    command = "bigBedToBed '{}' -maxItems=10 /dev/stdout | head -n 1".format(bb_location)
    try:
        first_line = sbp.check_output(command, shell=True).rstrip().decode()
        return tuple(first_line.split("\t"))
    except sbp.CalledProcessError:
        print('WARNING ({}): Couldn\'t fetch first item from bigBed file "{}".'.format(print_time(), bb_location))
    return None


def augment_knownGene_bed_file(organism, old_location):
    """
    knownGene tracks, which are very high priority, unfortunately have things in a slightly different format.
    We must get `name2` from the kgXref table, and `cdsStartStat`, `cdsEndStat` and `exonFrames` from the knownCds table.
    We can also get the itemRgb from the kgColor table.
    Furthermore, we stuff the `description` field from kgXref into the 19th standard bigGenePred column (geneName2).
    """
    print('INFO ({}): [db {}] Augmenting knownGene table.'.format(print_time(), organism))
    new_location = old_location[:-4] + '.fixed.bed'
    kgXref_gz_file = './{}/build/kgXref.txt.gz'.format(organism)
    kgColor_gz_file = './{}/build/kgColor.txt.gz'.format(organism)
    knownCds_gz_file = './{}/build/knownCds.txt.gz'.format(organism)
    kgXref = dict()
    kgColor = dict()
    knownCds = dict()
    
    if not fetch_table_tsv_gz(organism, 'kgXref', kgXref_gz_file):
        print('FAILED ({}): [db {}] Couldn\'t download .txt.gz for table "kgXref".'.format(print_time(), organism))
        return old_location
    elif not fetch_table_tsv_gz(organism, 'kgColor', kgColor_gz_file):
        print('FAILED ({}): [db {}] Couldn\'t download .txt.gz for table "kgColor".'.format(print_time(), organism))
        return old_location
    elif not fetch_table_tsv_gz(organism, 'knownCds', knownCds_gz_file):
        print('FAILED ({}): [db {}] Couldn\'t download .txt.gz for table "knownCds".'.format(print_time(), organism))
        return old_location
        
    with gzip.open(kgXref_gz_file, 'rt', newline="\n") as kgXref_handle:
        for line in kgXref_handle:
            fields = line.strip("\n").split("\t")
            kgXref[fields[0]] = (fields[4], re.sub(r'[\t\r\n]', ' ', fields[7]))
    
    with gzip.open(kgColor_gz_file, 'rt', newline="\n") as kgColor_handle:
        for line in kgColor_handle:
            fields = line.strip("\n").split("\t")
            kgColor[fields[0]] = ",".join(map(str, fields[1:4]))
    
    if os.path.isfile(knownCds_gz_file):
        with gzip.open(knownCds_gz_file, 'rt', newline="\n") as knownCds_handle:
            for line in knownCds_handle:
                fields = line.strip("\n").split("\t")
                knownCds[fields[0]] = (fields[1], fields[2], fields[4])
    
    with open(old_location, 'r') as read_handle:
        with open(new_location, 'w') as write_handle:
            for line in read_handle:
                fields = line.strip("\n").split("\t")
                name = fields[3]
                if name in kgXref:
                    fields[12] = kgXref[name][0]
                    fields[18] = kgXref[name][1]
                if name in kgColor:
                    fields[8] = kgColor[name]
                if name in knownCds:
                    fields[13:16] = knownCds[name]
                # Fixes pathological case of >1024 exons breaking bedToBigBed (see uc031qqx.1 in hg19)
                if int(fields[9]) > 1024:
                    fields[9] = 1
                    fields[10] = int(fields[2]) - int(fields[1])
                    fields[11] = 0
                    fields[15] = -1
                    fields = map(str, fields)
                print("\t".join(fields), file=write_handle)
            
    os.remove(kgXref_gz_file)
    os.remove(kgColor_gz_file)
    if os.path.isfile(knownCds_gz_file): os.remove(knownCds_gz_file)
    os.remove(old_location)
    return new_location


def extract_bed_plus_fields(track_type, as_location=None, as_string=None):
    num_standard_fields = 12
    as_parsed = None
    track_type = re.split(r'\s+', track_type)
    
    try: _, bed_type = get_as_and_bed_type_for_bedlike_format(track_type[0])
    except KeyError: bed_type = None
    
    if bed_type is not None:
        num_standard_fields = int(re.search(r'\d+', bed_type).group(0))
    elif len(track_type) > 1 and re.match(r'^\d+$', track_type[1]):
        num_standard_fields = int(track_type[1])
    
    if as_string is None:
        with open(as_location, 'r') as f:
            as_string = f.read()
    
    try:
        as_parsed = AutoSqlDeclaration(as_string)
    except:
        print('WARNING ({}): Can\'t parse autoSql file: {}'.format(print_time(), as_location or as_string))
        return None
    
    field_names = list(as_parsed.field_comments.keys())
    return field_names[num_standard_fields:]


def generate_big_bed(organism, bed_type, as_file, bed_file, bed_plus_fields=None, no_id=False):
    """
    Generates BigBed file. Make sure you have 'bedToBigBed' and 'bigBedInfo' in your $PATH
    """
    if not cmd_exists('bedToBigBed') or not cmd_exists('bigBedInfo'):
        sys.exit("FATAL: must have bedToBigBed and bigBedInfo installed on $PATH")
    
    bb_file = organism + '/bigBed/' + os.path.basename(bed_file)[:-4] + '.bb'
    chrom_sizes_file = "./{0}/build/chrom.sizes.txt".format(organism)
    bed_file_size = os.path.getsize(bed_file)
    num_cols = re.search(r'\d+', bed_type)
    indexable_fields = ['name'] if int(num_cols.group(0) if num_cols else 0) >= 4 else []
    whitelist = ['name2'] if no_id else ['name2', 'id']
    if bed_plus_fields is not None:
        indexable_fields += [field for field in bed_plus_fields if field in whitelist]

    if not os.path.isfile(chrom_sizes_file):
        urls = list(map(lambda url: url % (organism, organism), get_downloads_chrom_sizes()))
        if not rsync_or_curl(urls, chrom_sizes_file):
            print('FAILED: Couldn\'t fetch chromosome info')
            return None

    extra_index = ''
    if len(indexable_fields) > 0 and bed_file_size < MAX_INDEXABLE_BED_SIZE:
        extra_index = '-extraIndex="{}"'.format(",".join(indexable_fields))

    command = ('bedToBigBed -type="{1}" -as="{2}" {5} -tab "{3}" "./{0}/build/chrom.sizes.txt" '
               '"{4}"').format(organism, bed_type, as_file, bed_file, bb_file, extra_index)
    try:
        sbp.check_call(command, shell=True)
        sbp.check_call('bigBedInfo "{0}" 2>&1 >/dev/null'.format(bb_file), shell=True)
        print('DONE ({}): Constructed "{}" BigBed file for organism "{}"'.format(print_time(), bb_file, organism))
    except sbp.CalledProcessError:
        print('FAILED ({}): Couldn\'t construct "{}" BigBed file for organism "{}". '.format(print_time(), bb_file, organism))
        print('DEBUG: Used command: `{}`'.format(command))
        if os.path.isfile(bb_file): os.remove(bb_file) # Unlinks any incompletely generated files
        return None

    return bb_file


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
    
    print("DEBUG: " + (get_remote_item_url() % fields))
    try:
        response = urllib.request.urlopen(get_remote_item_url() % fields)
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
    file_location = get_wig_as_bigwig() % (organism, track_name, organism, track_name)
    
    if not url_exists(file_location):
        # Admittedly this hack was built entirely for phastCons100Way in hg19. Not sure if worth it.
        # FIXME: For http://hgdownload.cse.ucsc.edu/goldenPath/hg19/phyloP100way/ need to search for *.bw link on index page.
        first_digit = re.search('\\d', track_name)
        if first_digit is not None:
            inverted_name = track_name[first_digit.start():] + '.' + track_name[0:first_digit.start()]
            file_location = get_wig_as_bigwig() % (organism, track_name, organism, inverted_name)
        if first_digit is None or not url_exists(file_location):
            print('FAILED ({}): [db {}] URL for "{}" wig track (as bigWig file) is not reachable: {}'
                    .format(print_time(), organism, track_name, file_location))
            return None

    return file_location


def translate_settings(xcur, organism, table_name, parent_track, is_composite_track, sample_item, old_settings, 
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
        parent_pieces = re.split(r'\s+', old_settings['parent'])
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
    if table_name == 'knownGene': new_settings['itemRgb'] = 'on'
    # special exception for rmsk
    if table_name == 'rmsk': new_settings['useScore'] = 1
    # save bedPlusFields parsed from the autoSql file
    if bed_plus_fields is not None: new_settings['bedPlusFields'] = ",".join(bed_plus_fields)
    
    # Try to find the most palatable `url` setting for chromozoom, based on all the possible candidates saved in UCSC
    if 'directUrl' in old_settings: new_settings['url'] = old_settings['directUrl']
    elif url: new_settings['url'] = url.decode('latin1')
    if 'url' in new_settings and not re.match(r'^https?://', new_settings['url']):
        new_settings['url'] = get_ucsc_base_url() + re.sub(r'^/+', '', new_settings['url'])
    # As per the `url` specification in https://genome.ucsc.edu/goldenpath/help/trackDb/trackDbHub.html#commonSettings
    # inserting these placeholders into the URL tells chromozoom to substitute the corresponding info for each item.
    # https://genome.ucsc.edu/cgi-bin/hgc?db=$D&c=$S&l=${&r=$}&o=${&t=$}&g=$T&i=$$
    table_name = re.sub(r'^all_', '', table_name)
    if 'url' not in new_settings and test_default_remote_item_url(organism, table_name, sample_item):
        new_settings['url'] = get_remote_item_url() % ('$D', '$S', '${', '$}', '${', '$}', table_name, '$$')
    
    return json.dumps(new_settings)


def save_to_local_database(organism, localconn, row_vals, children = []):
    """
    Saves row_vals to the tracks table in the local SQLite database, and updates parentTrack on children, if provided
    """
    query = 'INSERT OR REPLACE INTO tracks VALUES (' + (','.join(['?'] * len(row_vals))) + ')'
    localconn.execute(query, row_vals)
    track_name = row_vals[0]
    print('INFO ({}): [db {}] Saved local database entry for track "{}".'.format(print_time(), organism, track_name))
    
    # Ensure child tracks of super tracks have parentTrack set correctly.
    for child_track_name in children:
        print('INFO ({}): [db {}] Also updated parentTrack on child "{}" for supertrack "{}".'.format(print_time(), 
                organism, child_track_name, track_name))
        localconn.execute('UPDATE tracks SET parentTrack = ? WHERE name = ?', (track_name, child_track_name))
    
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
        print('INFO ({}): [db {}] Setting composite track "{}" priority=999999 for having no children.'.format(
                print_time(), organism, track_name))
        localconn.execute('UPDATE tracks SET priority = 999999 WHERE name = ?', (track_name,))
    
    extra_clause = ' AND name NOT IN (' + (','.join(['?'] * len(empty_composite_tracks))) + ')'
    empty_supertracks = [row[0] for row in 
                         localconn.execute(query.format('==', extra_clause), empty_composite_tracks).fetchall()]
    for track_name in empty_supertracks:
        print('INFO ({}): [db {}] Setting supertrack "{}" priority=999999 for having no non-empty children.'.format(
                print_time(), organism, track_name))
        localconn.execute('UPDATE tracks SET priority = 999999 WHERE name = ?', (track_name,))
    
    localconn.commit()
