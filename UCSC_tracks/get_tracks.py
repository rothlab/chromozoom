import lib.ucsc_tracks as ut
import pymysql.cursors
import os
import argparse
import time
import sys
import re
from shutil import copyfile


parser = argparse.ArgumentParser(description='Fetch tracks from UCSC table browser and construct BigBed files.')
parser.add_argument('--out', action='store', type=str, default='./data',
                    help='Directory where finished data will be stored (default is ./data).')
parser.add_argument('--composite_tracks', action='store_true', default=False,
                    help='Scrape both simple and composite tracks from UCSC (default is simple only).')
parser.add_argument('--dry_run', action='store_true', default=False,
                    help='Don\'t actually fetch any data, just list the tracks and what would be updated.')
parser.add_argument('--priority_below', action='store', type=float, default=None,
                    help='Restrict scraping to tracks with calculated priority below this number (1-1000).')
parser.add_argument('--org_source', action='store', type=str, default='http://beta.chromozoom.org/php/chromsizes.php',
                    help='Location of organisms list in JSON format.')
parser.add_argument('--org_prefix', action='store', type=str, default='',
                    help='Restrict scraping to organism database names matching this prefix.')
parser.add_argument('--track_prefix', action='store', type=str, default=None,
                    help='Restrict scraping to tracks with names matching this prefix.')
parser.add_argument('--skip_tracks', action='store', type=str, default=None,
                    help='Don\'t scrape tracks with names matching this prefix. Takes precedence over --track_prefix')
parser.add_argument('--table_source', action='store', type=str, default='',
                    help='URL for the Table Browser webpage. Leave blank to retrieve it from the ../ucsc.yaml config file')
parser.add_argument('--mysql_host', action='store', type=str, default='',
                    help='Hostname for UCSC\'s MySQL server. Leave blank to retrieve it from the ../ucsc.yaml config file')
parser.add_argument('--downloads_base_url', action='store', type=str, default='',
                    help='Base URL for bulk downloads from UCSC. Leave blank to retrieve it from the ../ucsc.yaml config file')
args = parser.parse_args()


script_directory = os.path.dirname(os.path.abspath(__file__))
if not os.path.exists(args.out): os.makedirs(args.out)
os.chdir(args.out)

table_source = ut.get_remote_table() if args.table_source == '' else args.table_source
tracks_source = ut.get_remote_tracks()
mysql_host = ut.get_mysql_host() if args.mysql_host == '' else args.mysql_host
wig_as_bigwig = ut.get_wig_as_bigwig()
downloads_base_url = ut.get_downloads_base_url() if args.downloads_base_url == '' else args.downloads_base_url
downloads_base_url = downloads_base_url.rstrip('/')


for organism in ut.get_organisms_list(args.org_source, args.org_prefix):
    print('#####################################')
    print('INFO ({}): FETCHING DATA FOR ORGANISM: {}'.format(ut.print_time(), organism))
    print('INFO ({}): EXTRACTING TRACK HIERARCHY!'.format(ut.print_time()))
    track_meta = ut.create_hierarchy(organism, table_source)
    if not track_meta:
        print('WARNING ({}): No tables for {} found. Omitting.'.format(ut.print_time(), organism))
        continue

    # Try connecting to UCSC's MySQL database
    try:
        conn = pymysql.connect(host=mysql_host, user='genome', database=organism)
        cur = conn.cursor()
    except pymysql.err.InternalError:
        print('WARNING ({}): No MySQL tables found for "{}". Omitting.'.format(ut.print_time(), organism))
        continue
    ut.setup_directories(organism)

    selected_tracks, track_info = ut.distill_hierarchy(track_meta, args.composite_tracks)
    selected_tracks_having_tables = ut.filter_to_existing_tables(selected_tracks, cur)
    if args.composite_tracks is False:
        selected_tracks = selected_tracks_having_tables
    track_priority = ut.get_priority(db=organism, selection=selected_tracks, tracks_source=tracks_source, 
                                           track_info=track_info)
    if args.priority_below is not None:
        selected_tracks = [t for t in selected_tracks if track_priority[t] <= args.priority_below]
    if args.track_prefix is not None:
        selected_tracks = [t for t in selected_tracks if t.startswith(args.track_prefix)]
    if args.skip_tracks is not None:
        selected_tracks = [t for t in selected_tracks if not t.startswith(args.skip_tracks)]
    
    local_db, localcur, localconn = ut.create_sqllite3_db(organism)
    last_updates = ut.get_last_local_updates(localcur)
    
    my_tracks = ut.fetch_tracks(host=mysql_host, db_name=organism, xcur=cur, selection=selected_tracks)
    my_tracks = sorted(my_tracks, key=lambda row: (track_info[row[0]]['parentTrack'], row[0]))
    
    for table_name, tr_type, group, short_label, long_label, html_description, settings, url in my_tracks:
        parent_track = track_info[table_name]['parentTrack']
        print('INFO ({}): [db {}] Checking table "{}" (track {}).'.format(ut.print_time(), organism, table_name, parent_track))
        
        save_to_db = False
        file_location = None
        bed_plus_fields = None
        sample_item = None
        composite_track = table_name not in selected_tracks_having_tables
        remote_settings = ut.parse_trackdb_settings(settings)
        update_date = None
        bedlike_format = ut.is_bedlike_format(tr_type)

        # check if we need to update the table
        if not composite_track and table_name in last_updates:
            update_date = ut.get_update_time(cur, organism, table_name)
            if last_updates[table_name] == update_date:
                print('INFO ({}): [db {}] data for table "{}" is up to date.'.format(ut.print_time(),
                        organism, table_name))
                continue
            else:
                print('INFO ({}): [db {}] Need to update table "{}".'.format(ut.print_time(), organism, table_name))
        else:
            track_noun = "composite track" if composite_track else "table"
            print('INFO ({}): [db {}] Need to fetch {} "{}".'.format(ut.print_time(), organism, track_noun, table_name))
        if table_name in last_updates and not args.dry_run:
            localcur.execute('DELETE FROM tracks WHERE name="{}";'.format(table_name))
        
        if args.dry_run: continue
        
        # Composite track processing -- aren't backed by an actual MySQL table, but instead are groups of other tracks
        if composite_track:
            # No fetching/conversion to do--only need to translate the settings from UCSC trackDb --> chromozoom.
            save_to_db = True
            
        elif True:
            pass

        # bigWig, bigBed, and BAM processing - these files are already in big* format and accessible by URL, so little work to do
        elif tr_type.startswith('bigWig ') or tr_type.startswith('bigBed ') or tr_type == 'bam':
            file_location = ut.qups("SELECT fileName FROM {}".format(table_name), cur)

            if len(file_location) > 1:
                print('WARNING ({}): [db {}] Multiple files are associated with "{}" "({})" file.'
                      .format(ut.print_time(), organism, table_name, tr_type))
            file_location = file_location[0][0]
            if not re.match(r'^https?://', file_location):
                file_location = downloads_base_url + file_location
            if tr_type.startswith('bigBed '):
                sample_item = ut.get_first_item_from_bigbed(file_location)
                as_string = ut.fetch_autosql_for_bigbed(file_location)
                if as_string is not None:
                    bed_plus_fields = ut.extract_bed_plus_fields(tr_type, as_string=as_string)
            print('DONE ({}): [db {}] Fetched remote location for "{}" "{}" file.'.format(ut.print_time(),
                    organism, table_name, tr_type))
            save_to_db = True

        # wig - these tracks are luckily accessible as bigWig files, so again we simply link to their URL
        elif tr_type.startswith('wig '):
            file_location = wig_as_bigwig % (organism, table_name, organism, table_name)
            if not ut.url_exists(file_location):
                print('FAILED ({}): [db {}] URL for "{}" "{}" file (as bigWig) is not reachable: {}'
                      .format(ut.print_time(), organism, table_name, tr_type, file_location))
                continue
            print('DONE ({}): [db {}] Fetched remote location for "{}" "wig" file, as bigWig.'.format(ut.print_time(),
                    organism, table_name))
            save_to_db = True

        # BED, genePred, PSL, GVF, and narrowPeak processing - need to save and convert these to bigBed
        elif bedlike_format:
            bed_location = ut.fetch_bed_table(cur, table_name, organism, bedlike_format)
            if bed_location is None:
                continue
            # An uncompressed copy of the cytoBandIdeo track is kept alongside tracks.db
            if table_name == 'cytoBandIdeo':
                copyfile(bed_location, './{}/cytoBandIdeo.bed'.format(organism))
            
            as_location, bed_type = ut.get_as_and_bed_type_for_bedlike_format(bedlike_format)
            if as_location is None: # Generic BED tracks have autoSql specifying their fields on UCSC's MySQL server
                as_location = ut.fetch_as_file(bed_location, cur, table_name)
                bed_type = tr_type.replace(' ', '').rstrip('.')
            
            bed_plus_fields = ut.extract_bed_plus_fields(tr_type, as_location=as_location)
            file_location = ut.generate_big_bed(organism, bed_type, as_location, bed_location, bed_plus_fields)

            # If bigBed building failed, try fixing the autosql file once and retrying
            if file_location is None:
                try:
                    ut.fix_bed_as_files(bed_location, bed_type)
                    file_location = ut.generate_big_bed(organism, bed_type, as_location, bed_location)
                except:
                    pass
            if file_location is None:
                continue
            
            # Delete interim files for successful builds
            sample_item = ut.get_first_item_from_bed(bed_location)
            os.remove(bed_location)
            if not as_location.startswith(os.path.join(script_directory, 'autosql')): 
                os.remove(as_location)
            save_to_db = True
            
        else:
            print('INFO ({}): [db {}] Unhandled track type "{}" for table "{}".'.format(ut.print_time(), organism,
                                                                                      tr_type, table_name))
            continue

        if save_to_db:
            local_settings = ut.translate_settings(cur, organism, table_name, parent_track, composite_track, sample_item, 
                    remote_settings, bed_plus_fields, url)
            row_vals = (table_name, track_info[table_name]['displayName'], tr_type, group, track_info[table_name]['groupLabel'], 
                    parent_track, track_info[table_name]['trackLabel'], short_label, long_label, track_priority[table_name], 
                    file_location, html_description, update_date, settings, local_settings, composite_track)
            command = 'INSERT INTO tracks VALUES (' + (','.join(['?'] * len(row_vals))) + ')'
            localcur.execute(command, row_vals)
            
        localconn.commit()
