import lib.buildfunctions as buildfun
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
parser.add_argument('--skip_prefix', action='store', type=str, default=None,
                    help='Don\'t scrape tables with names matching this prefix.')
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

table_source = buildfun.get_remote_table() if args.table_source == '' else args.table_source
tracks_source = buildfun.get_remote_tracks()
mysql_host = buildfun.get_mysql_host() if args.mysql_host == '' else args.mysql_host
wig_as_bigwig = buildfun.get_wig_as_bigwig()
downloads_base_url = buildfun.get_downloads_base_url() if args.downloads_base_url == '' else args.downloads_base_url
downloads_base_url = downloads_base_url.rstrip('/')


for organism in buildfun.get_organisms_list(args.org_source, args.org_prefix):
    print('#####################################')
    print('INFO ({}): FETCHING DATA FOR ORGANISM: {}'.format(buildfun.print_time(), organism))
    print('INFO ({}): EXTRACTING TRACK HIERARCHY!'.format(buildfun.print_time()))
    track_meta = buildfun.create_hierarchy(organism, table_source)
    if not track_meta:
        print('WARNING ({}): No tables for {} found. Omitting.'.format(buildfun.print_time(), organism))
        continue

    # Try connecting to UCSC's MySQL database
    try:
        conn = pymysql.connect(host=mysql_host, user='genome', database=organism)
        cur = conn.cursor()
    except pymysql.err.InternalError:
        print('WARNING ({}): No MySQL tables found for "{}". Omitting.'.format(buildfun.print_time(), organism))
        continue
    buildfun.setup_directories(organism)

    selected_tracks, track_info = buildfun.distill_hierarchy(track_meta, args.composite_tracks)
    selected_tracks = buildfun.filter_extractable_dbs(selected_tracks, cur)
    track_priority = buildfun.get_priority(db=organism, selection=selected_tracks, tracks_source=tracks_source, 
                                           track_info=track_info)
    if args.priority_below is not None:
        selected_tracks = [t for t in selected_tracks if track_priority[t] <= args.priority_below]
    if args.skip_prefix is not None:
        selected_tracks = [t for t in selected_tracks if not t.startswith(args.skip_prefix)]
    
    local_db, localcur, localconn = buildfun.create_sqllite3_db(organism)
    last_updates = buildfun.get_last_local_updates(localcur)
    
    my_tracks = buildfun.fetch_tracks(host=mysql_host, db_name=organism, xcur=cur, selection=selected_tracks)
    my_tracks = sorted(my_tracks, key=lambda row: (track_info[row[0]]['parentTrack'], row[0]))

    for table_name, tr_type, group, short_label, long_label, html_description, remote_settings, url in my_tracks:
        parent_track = track_info[table_name]['parentTrack']
        print('INFO ({}): [db {}] Checking table "{}" (track {}).'.format(buildfun.print_time(), organism, table_name, parent_track))
        save_to_db = False
        bed_plus_fields = None
        sample_item = None
        update_date = buildfun.get_update_time(cur, organism, table_name)
        bedlike_format = buildfun.is_bedlike_format(tr_type)

        # check if we need to update the table
        if table_name in last_updates:
            if last_updates[table_name] == update_date:
                print('INFO ({}): [db {}] data for table "{}" is up to date.'.format(buildfun.print_time(),
                                                                                          organism, table_name))
                continue
            else:
                print('INFO ({}): [db {}] Need to update table "{}".'.format(buildfun.print_time(), organism, table_name))
                if not args.dry_run: localcur.execute('DELETE FROM tracks WHERE name="{}";'.format(table_name))
        else:
            print('INFO ({}): [db {}] Need to fetch table "{}".'.format(buildfun.print_time(), organism, table_name))
        if args.dry_run: continue

        # bigWig, bigBed, and BAM processing - these files are already in big format and accessible by URL, so little work to do
        if tr_type.startswith('bigWig ') or tr_type.startswith('bigBed ') or tr_type == 'bam':
            file_location = buildfun.qups("SELECT fileName FROM {}".format(table_name), cur)

            if len(file_location) > 1:
                print('WARNING ({}): [db {}] Multiple files are associated with "{}" "({})" file.'
                      .format(buildfun.print_time(), organism, table_name, tr_type))
            file_location = file_location[0][0]
            if not re.match(r'^https?://', file_location):
                file_location = downloads_base_url + file_location
            if tr_type.startswith('bigBed '):
                sample_item = buildfun.get_first_item_from_bigbed(file_location)
                as_string = buildfun.fetch_autosql_for_bigbed(file_location)
                if as_string is not None:
                    bed_plus_fields = buildfun.extract_bed_plus_fields(tr_type, as_string=as_string)
            print('DONE ({}): [db {}] Fetched remote location for "{}" "{}" file.'.format(buildfun.print_time(),
                                                                                                 organism, table_name, 
                                                                                                 tr_type))
            save_to_db = True

        # wig - these tracks are luckily accessible as bigWig files, so again we simply link to their URL
        elif tr_type.startswith('wig '):
            file_location = wig_as_bigwig % (organism, table_name, organism, table_name)
            if not buildfun.url_exists(file_location):
                print('FAILED ({}): [db {}] URL for "{}" "{}" file (as bigWig) is not reachable: {}'
                      .format(buildfun.print_time(), organism, table_name, tr_type, file_location))
                continue
            print('DONE ({}): [db {}] Fetched remote location for "{}" "wig" file, as bigWig.'.format(buildfun.print_time(),
                                                                                                 organism, table_name))
            save_to_db = True

        # BED, genePred, PSL, GVF, and narrowPeak processing - need to save and convert these to bigBed
        elif bedlike_format:
            bed_location = buildfun.fetch_bed_table(cur, table_name, organism, bedlike_format)
            if bed_location is None:
                continue
            # An uncompressed copy of the cytoBandIdeo track is kept alongside tracks.db
            if table_name == 'cytoBandIdeo':
                copyfile(bed_location, './{}/cytoBandIdeo.bed'.format(organism))
            
            as_location, bed_type = buildfun.get_as_and_bed_type_for_bedlike_format(bedlike_format)
            if as_location is None: # Generic BED tracks have autoSql specifying their fields on UCSC's MySQL server
                as_location = buildfun.fetch_as_file(bed_location, cur, table_name)
                bed_type = tr_type.replace(' ', '').rstrip('.')
            
            bed_plus_fields = buildfun.extract_bed_plus_fields(tr_type, as_location=as_location)
            file_location = buildfun.generate_big_bed(organism, bed_type, as_location, bed_location, bed_plus_fields)

            # If bigBed building failed, try fixing the autosql file once and retrying
            if file_location is None:
                try:
                    buildfun.fix_bed_as_files(bed_location, bed_type)
                    file_location = buildfun.generate_big_bed(organism, bed_type, as_location, bed_location)
                except:
                    pass
            if file_location is None:
                continue
            
            # Delete interim files for successful builds
            sample_item = buildfun.get_first_item_from_bed(bed_location)
            os.remove(bed_location)
            if not as_location.startswith(os.path.join(script_directory, 'autosql')): 
                os.remove(as_location)
            save_to_db = True
            
        else:
            print('INFO ({}): [db {}] Unhandled track type "{}" for table "{}".'.format(buildfun.print_time(), organism,
                                                                                      tr_type, table_name))
            continue

        if save_to_db:
            local_settings = buildfun.translate_settings(organism, table_name, sample_item, remote_settings, 
                                                         bed_plus_fields, url)
            row_vals = (table_name, track_info[table_name]['displayName'], tr_type, group, track_info[table_name]['groupLabel'], 
                    parent_track, track_info[table_name]['trackLabel'], short_label, long_label, track_priority[table_name], 
                    file_location, html_description, update_date, remote_settings, local_settings)
            command = 'INSERT INTO tracks VALUES (' + (','.join(['?'] * len(row_vals))) + ')'
            localcur.execute(command, row_vals)
        localconn.commit()
