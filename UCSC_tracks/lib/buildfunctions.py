from lxml import html
import pymysql.cursors
import sqlite3
import urllib.request
import os, sys
import subprocess as sbp
import re
import json
import fileinput
import time

# Cache the parsed config file after the first access
config_yaml = None

def open_ucsc_yaml():
    global config_yaml
    if config_yaml is not None:
        return config_yaml
    try:
        import yaml
        with open('../ucsc.yaml', 'r') as handle:
            config_yaml = yaml.load(handle)
    except ImportError:
        sys.exit('FATAL: could not read ../config.yaml.')
    return config_yaml
    

def print_time():
    """
    :return: current time string
    """
    return time.strftime('%X %x')


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
    c = xconn.cursor()
    if new_db:
        c.execute("CREATE TABLE tracks (name, displayName, type, grp, grpLabel, parentTrack, trackLabel, "
                  "shortLabel, longLabel, priority, location, html longblob, updateDate)")
    return db_loc, c, xconn

def get_last_local_updates(localcur):
    localcur.execute('SELECT name, updateDate FROM tracks;')
    return dict(localcur.fetchall())

def get_remote_table():
    cfg = open_ucsc_yaml()
    return cfg['browser_hosts']['authoritative'] + cfg['browser_urls']['tables']

def get_mysql_host():
    return open_ucsc_yaml()['browser_mysql']['authoritative']

def get_downloads_base_url():
    return open_ucsc_yaml()['data_urls']['downloads']

def get_downloads_table_tsv():
    return open_ucsc_yaml()['data_urls']['table_tsv']

def get_remote_tracks():
    cfg = open_ucsc_yaml()
    return cfg['browser_hosts']['authoritative'] + cfg['browser_urls']['tracks']


def cmd_exists(cmd):
    """
    Check if a given executable is on $PATH
    For more on the `type` shell builtin, see https://bash.cyberciti.biz/guide/Type_command
    """
    return sbp.call("type " + cmd, shell=True, stdout=sbp.PIPE, stderr=sbp.PIPE) == 0


def qups(in_cmd, ucur):
    """
    Executes MySQL query and returns parsed results
    """
    ucur.connection.ping(reconnect=True)
    ucur.execute(in_cmd)
    return ucur.fetchall()


def get_update_time(xcur, db, table_name):
    """
    Fetches table update time
    """
    return str(qups(("SELECT UPDATE_TIME FROM information_schema.tables "
                     "WHERE TABLE_SCHEMA='{}' AND TABLE_NAME='{}'").format(db, table_name), xcur)[0][0])


def get_numrows(xcur, table_name):
    return qups("SELECT COUNT(*) FROM {}".format(table_name), xcur)[0][0]


def get_organisms_list(url='http://beta.chromozoom.org/php/chromsizes.php', prefix=''):
    """
    Get list of organism databases that we may want to scrape from UCSC
    """

    with urllib.request.urlopen(url) as response:
        my_html = response.read().decode()
        my_html = json.loads(my_html)

    org_names = [organism['name'] for organism in my_html]
    if prefix != '':
        org_names = [name for name in org_names if name.startswith(prefix)]
    
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
    
    for track in selection:
        sel_name = re.sub(r'^all_', '', track)
        track_default_visibility = track_form.xpath('//select[@name="{}"]/option[@selected]/text()'.format(sel_name))
        if track == gene_tracks[0] or track in special_high_priority:
            priorities[track] = 1
        elif len(track_default_visibility) > 0 and track_default_visibility[0] != 'hide':
            priorities[track] = 10
        else:
            priorities[track] = 100
            parent_track = track_info[track]['parentTrack']
            if parent_track != sel_name:
                # Complex track incurs additional penalty proportional to number of subtracks
                num_subtracks = len([k for (k, v) in track_info.items() if v['parentTrack'] == parent_track])
                penalty = 3 if num_subtracks > 10 else (2 if num_subtracks > 3 else 0.5)
                priorities[track] = int(priorities[track] * penalty)
        
    return priorities
    

def create_hierarchy(organism, table_source):
    """
    Creates a file with tables hierarchy for a given organism.
    """
    save_dir = './_hierarchy/'
    location = save_dir + '{}.txt'.format(organism)

    if not os.path.isdir(save_dir):
        os.mkdir(save_dir)
    if os.path.isfile(location):
        return location

    w_file = open(location, 'w')

    print('Organism: {}'.format(organism), file=w_file)
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
    track_info = dict()
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
            if 'Trackgroup: ' in line:
                process_tables()
                curr_tgroupname = line.split('(', 1)[1][:-2]
            elif 'Track:' in line:
                process_tables()
                curr_track = line.split()[1]
                curr_trackname = line.split('(', 1)[1][:-2]
            elif 'Table:' in line:
                curr_table = line.split()[1]
                curr_track_tables.append(curr_table)
                curr_track_lines[curr_table] = line
    process_tables() # Process last track's tables.
    
    return selected_tracks, track_info


def filter_extractable_dbs(wanted_tracks, xcur):
    """
    Checks which tracks in wanted_tracks can be extracted from UCSC databases, returns a filtered list
    """
    track_data = set([table[0] for table in qups("SELECT tableName FROM trackDb", xcur)])
    # Allow some tables, like mrna, and est, to by prefixed by "all_"
    track_data = track_data | set(["all_" + track for track in track_data])
    tracks_tables = set([table[0] for table in qups("SHOW TABLES", xcur)])
    extractable = track_data & tracks_tables & set(wanted_tracks)
    return extractable


def fetch_tracks(host=None, db_name='hg19', xcur=None, selection=None):
    """
    Fetches track information from the specified UCSC database, which is in the trackDb table
    :return:
    """
    if xcur is None:
        xconn = pymysql.connect(host=host, user='genome', database=db_name)
        xcur = xconn.cursor()     # get the cursor

    if selection:
        # the trackDb table drops the "all_" prefix for certain tables, like all_mrna and all_est
        fixed_selection = [re.sub(r'^all_', '', element) for element in selection]
        in_clause = ','.join(['"' + element + '"' for element in fixed_selection])
        tracks = qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings "
                     "FROM trackDb WHERE tableName in ({})").format(in_clause), xcur)
    else:
        tracks = qups(("SELECT tableName, type, grp, shortLabel, longLabel, html, settings "
                     "FROM trackDb ORDER BY tableName"), xcur)
    
    tracks = [list(track) for track in tracks]
    for track in tracks:
        if "all_" + track[0] in selection:
            track[0] = "all_" + track[0]
    
    return tracks


def setup_directories(organism):
    """
    Sets up directories and files needed for track fetching
    """

    # Build directory
    if not os.path.exists(organism):
        os.makedirs(organism)

    if not os.path.exists(organism + '/build'):
        os.makedirs(organism + '/build')

    if not os.path.exists(organism + '/bigBed'):
        os.makedirs(organism + '/bigBed')


def fetch_as_file(bed_location, xcur, table_name):
    """
    Creates an auto_sql file and returns its location
    """

    as_file = bed_location[:-4] + '.as'
    as_contents = qups('SELECT autoSqlDef FROM tableDescriptions WHERE tableName="{}";'.format(table_name),
                      xcur)[0][0].decode()

    # Column bin removal
    bin_rows = re.compile('[\t\s]*(short|uint|string|ushort)[\t\s]+bin;')
    if bin_rows.search(as_contents):
        as_contents = '\n'.join([line for line in as_contents.split('\n') if not bin_rows.match(line)])

    old_colors = 'uint itemRgb;'
    if old_colors in as_contents:
        replace_line = '    uint reserved;     "Used as itemRgb as of 2004-11-22"'
        as_contents = '\n'.join([replace_line if old_colors in line else line for line in as_contents.split('\n')])

    w_file = open(as_file, 'w')
    w_file.write(as_contents)

    return as_file


def fetch_table_fields(xcur, table_name):
    return [val[0] for val in qups("SHOW columns FROM {}".format(table_name), xcur)]


def fix_bed_as_files(blocation, btype):
    """
    Tries to fix Bed auto_sql if initial BigBed building failed
    """
    def_types = ['string', 'uint', 'uint', 'string', 'uint', 'char[1]', 'uint', 'uint', 'uint']
    def_names = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand', 'thickStart', 'thickEnd', 'reserved']
    bed_num = int(re.findall(r'\d+', btype)[0])
    as_file = blocation[:-4] + '.as'
    all_lines = open(as_file, 'r').read().split('\n')
    elements_lines = all_lines[3:][:bed_num]

    # Set default names and types
    for dtype, dname, eline, lnum in zip(def_types, def_names, elements_lines, range(3, 16)):
        all_lines[lnum] = (dtype + ' ' + eline.split(maxsplit=1)[1])

        lin1, lin2 = eline.split(';', maxsplit=1)
        lin1 = lin1.rsplit(maxsplit=1)
        lin1[1] = dname
        all_lines[lnum] = '; '.join([' '.join(lin1), lin2])

    open(as_file, 'w').write('\n'.join(all_lines))

    # Repair maximum and minimum score
    if bed_num >= 5:
        for line in fileinput.input(blocation, inplace=True):
            line = line.strip().split('\t')
            if int(line[4]) > 1000:
                line[4] = '1000'
            if int(line[4]) < 0:
                line[4] = '0'
            print('\t'.join(line))


def generate_big_bed(organism, btype, as_file, b_file):
    """
    Generates BigBed file. Make sure you have 'fetchChromSizes' and 'bedToBigBed' in your $PATH
    """
    if not cmd_exists('fetchChromSizes'):
        sys.exit("FATAL: must have fetchChromSizes installed on $PATH")
    if not cmd_exists('bedToBigBed'):
        sys.exit("FATAL: must have bedToBigBed installed on $PATH")
        
    bb_file = organism + '/bigBed/' + os.path.basename(b_file)[:-4] + '.bb'

    if not os.path.isfile("./{0}/build/chsize.txt".format(organism)):
        command = 'fetchChromSizes "{0}" > "./{0}/build/chsize.txt" 2>/dev/null'.format(organism)
        try:
            sbp.check_call(command, shell=True)
        except sbp.CalledProcessError:
            print('FAILED: Couldn\'t fetch chromosome info')
            return None

    # FIXME: Add -extraIndex parameter here for name field
    command = ('bedToBigBed -type="{1}" -as="{2}" -tab "{3}" "./{0}/build/chsize.txt" '
               '"{4}"').format(organism, btype, as_file, b_file, bb_file)
    try:
        sbp.check_call(command, shell=True)
        print('DONE ({}): Constructed "{}" BigBed file for organism "{}"'.format(print_time(), bb_file, organism))
    except sbp.CalledProcessError:
        print(('FAILED ({}): Couldn\'t construct "{}" BigBed file for organism "{}". '
              'Used command: `{}`').format(print_time(), organism, bb_file, command))
        return None

    return bb_file


def fetch_bed_table(host, xcur, table_name, organism, bedlike_format=None):
    """
    Uses mySQL query to fetch columns from bed file
    """
    gz_file = './{}/build/{}.txt.gz'.format(organism, table_name)
    location = './{}/build/{}.bed'.format(organism, table_name)
    table_fields = fetch_table_fields(xcur, table_name)
    has_bin_column = table_fields[0] == 'bin'
    cut_bin_column = '| cut -f 2- ' if has_bin_column else ''
    has_genePred_fields = table_fields[-4:] == ['name2', 'cdsStartStat', 'cdsEndStat', 'exonFrames']

    url = get_downloads_table_tsv() % (organism, table_name)
    # Note: formerly, we attempted to fetch the data via MySQL, but this would time out for large tables
    # command = ("mysql -N -A -u genome -h {} -e 'SELECT {} FROM {}' {} >'{}' "
    #            "2>/dev/null").format(host, headers, table_name, organism, location)
    # The most robust fetching method is rsync.
    
    if cmd_exists('rsync'):
        command = "rsync -avzP --timeout=30 '{}' '{}'".format(url, os.path.dirname(gz_file))
    else:
        url = re.sub(r'^rsync://', 'http://', url)
        command = "curl '{}' --output '{}'".format(url, gz_file)
    
    returncode = None
    retries = 3
    while returncode != 0 and retries > 0:
        try:
            sbp.check_call(command, shell=True)
        except sbp.CalledProcessError as err:
            returncode = err.returncode
            retries -= 1
        returncode = 0
    
    if bedlike_format == 'genePred':
        # See https://genome.ucsc.edu/goldenPath/help/bigGenePred.html
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
        command = "cat '{}' | zcat | awk -v OFS=\"\\t\" '{}' | sort -k1,1 -k2,2n >'{}'".format(gz_file, awk_script, location)
        # FIXME: For knownGene tracks, can get name2 from kgXref and the other three columns from knownCds
        #        Would have to manually glob on these columns with another function.
        #        Could further stuff the "description" into the 19th standard bigGenePred column (geneName2).
    elif bedlike_format == 'psl':
        # See https://genome.ucsc.edu/goldenPath/help/bigPsl.html
        if not cmd_exists('pslToBigPsl'):
            sys.exit("FATAL: must have pslToBigPsl installed on $PATH")
        command = "cat '{}' | zcat {}| pslToBigPsl /dev/stdin stdout | sort -k1,1 -k2,2n >'{}'".format(gz_file, 
                                                                                                    cut_bin_column, location)
    elif bedlike_format is None:
        command = "cat '{}' | zcat {}>'{}'".format(gz_file, cut_bin_column, location)
    else:
        print('FAILED ({}): [db {}] "{}" {} conversion to BED not handled.'.format(print_time(), organism, table_name, 
                                                                                    bedlike_format))
        return None
    
    try:
        sbp.check_call(command, shell=True)
        os.remove(gz_file)
        print('DONE ({}): [db {}] Fetched "{}" into a BED file'.format(print_time(), organism, table_name))
    except sbp.CalledProcessError:
        print('FAILED ({}): [db {}] Couldn\'t fetch "{}" as a BED file.'.format(print_time(), organism, table_name))
        print(command)
        return None
    
    return location
