import lib.ucsc_tracks as ut
import pymysql.cursors
import os
import argparse
import time
import sys
import re
from shutil import copyfile


parser = argparse.ArgumentParser(description='Fetch tracks from UCSC table browser and construct BigBed files.')
parser.add_argument('-o', '--out', action='store', type=str, default='./data',
                    help='Directory where finished data will be stored (default is ./data).')
parser.add_argument('-n', '--dry_run', action='store_true', default=False,
                    help='Don\'t actually fetch any data, just list the tracks and what would be updated.')
parser.add_argument('-N', '--update_metadata_only', action='store_true', default=False,
                    help='Don\'t fetch any track data, just update each track\'s metadata in the local database.')
parser.add_argument('-g', '--org_prefix', action='store', type=str, default='',
                    help='Restrict scraping to organism database names matching this prefix.')
parser.add_argument('-C', '--composite_tracks', action='store_true', default=False,
                    help='Also scrape composite tracks from UCSC (default is simple only).')
parser.add_argument('-S', '--super_tracks', action='store_true', default=False,
                    help='Also scrape supertracks from UCSC (default is simple only).')
parser.add_argument('-P', '--priority_below', action='store', type=float, default=None,
                    help='Restrict scraping to tracks with calculated priority below this number (1-1000).')
parser.add_argument('-t', '--track_prefix', action='store', type=str, default=None,
                    help='Restrict scraping to tracks with names matching this prefix.')
parser.add_argument('-s', '--skip_tracks', action='store', type=str, default=None,
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
downloads_base_url = ut.get_downloads_base_url() if args.downloads_base_url == '' else args.downloads_base_url
downloads_base_url = downloads_base_url.rstrip('/')

# ====================================================================
# = For every organism in the list of organisms we wish to scrape... =
# ====================================================================

for organism in ut.get_organisms_list(host=mysql_host, prefix=args.org_prefix):
    print('#####################################')
    print('INFO ({}): FETCHING DATA FOR ORGANISM: {}'.format(ut.print_time(), organism))
    print('INFO ({}): EXTRACTING TRACK HIERARCHY!'.format(ut.print_time()))
    track_meta = ut.create_hierarchy(organism, table_source)
    if not track_meta:
        print('WARNING ({}): No tables for {} found. Omitting.'.format(ut.print_time(), organism))
        continue

    # Try connecting to the UCSC MySQL database for this organism
    cur = ut.connect_to_ucsc_mysql(host=mysql_host, db=organism)
    if cur is None: continue
    
    # Setup our local directories where track data will be saved
    ut.setup_directories(organism)
    
    # ==================================================================================================
    # = Generate a complete list of tracks to scrape based on UCSC's database and the script arguments =
    # ==================================================================================================

    selected_tracks, track_info = ut.distill_hierarchy(track_meta, args.composite_tracks)
    selected_tracks_having_tables = ut.filter_to_existing_tables(selected_tracks, cur)
    if args.composite_tracks is False:
        selected_tracks = selected_tracks_having_tables

    track_priority = ut.get_priority(db=organism, selection=selected_tracks, tracks_source=tracks_source, 
                                     track_info=track_info)
    
    selected_tracks = ut.filter_tracks_by_args(selected_tracks, args, track_priority)
    
    local_db, localconn = ut.create_sqllite3_db(organism)
    last_updates = ut.get_last_local_updates(localconn)
    
    my_tracks = ut.fetch_tracks(xcur=cur, selection=selected_tracks)
    my_tracks = sorted(my_tracks, key=lambda row: (track_info[row[0]]['parentTrack'], row[0]))
    
    if args.super_tracks is True:
        supertracks = ut.fetch_supertracks(xcur=cur, track_info=track_info)
        # It's crucial that supertracks are saved last, since they update the parentTrack field for child tracks
        my_tracks += supertracks
        track_priority.update(ut.get_priority(db=organism, selection=[t[0] for t in supertracks], tracks_source=tracks_source, 
                                              track_info=track_info))
    
    # =======================================================================================
    # = Iterate over tracks to be scraped, saving data into local directories and tracks.db =
    # =======================================================================================
    
    for track_name, tr_type, group, short_label, long_label, html_description, settings, url, sort, children in my_tracks:
        parent_track = track_info[track_name]['parentTrack']
        print('INFO ({}): [db {}] Checking table "{}" (track {}).'.format(ut.print_time(), organism, track_name, parent_track))
        
        file_location, bed_location, as_location = (None, None, None)
        bed_plus_fields = None
        sample_item = None
        track_has_a_table = track_name in selected_tracks_having_tables
        remote_settings = ut.parse_trackdb_settings(settings)
        is_composite_or_super = not track_has_a_table and 'bigDataUrl' not in remote_settings
        is_super_track = len(children) > 0
        update_date = None
        bedlike_format = ut.is_bedlike_format(tr_type)

        # First, check if we need to update the table at all
        if track_has_a_table:
            update_date = ut.get_update_time(cur, organism, track_name)
        if track_has_a_table and track_name in last_updates:
            if not args.update_metadata_only and last_updates[track_name] == update_date:
                print('INFO ({}): [db {}] data for table "{}" is up to date.'.format(ut.print_time(),
                        organism, track_name))
                continue
            else:
                print('INFO ({}): [db {}] Need to update table "{}".'.format(ut.print_time(), organism, track_name))
        else:
            track_noun = "supertrack" if is_super_track else ("composite track" if is_composite_or_super else "table")
            print('INFO ({}): [db {}] Need to fetch {} "{}".'.format(ut.print_time(), organism, track_noun, track_name))
        if track_name in last_updates and not args.dry_run:
            file_location, bed_plus_fields = ut.get_last_location_and_bed_plus_fields(localconn, track_name)
        
        if args.dry_run: continue
        
        # Composite track/supertrack processing -- aren't backed by an actual MySQL table, but instead are groups of other tracks
        if is_composite_or_super:
            # No fetching/conversion to do--only need to translate the settings from UCSC's trackDb format --> chromozoom.
            pass

        # bigWig, bigBed, and BAM processing - these files are already in big* format and accessible by URL, so little to do
        elif tr_type.startswith('bigWig ') or tr_type.startswith('bigBed ') or tr_type in ('bam', 'vcfTabix'):
            file_location = [[remote_settings.get('bigDataUrl')]]
            if file_location[0][0] is None:
                file_location = ut.qups("SELECT fileName FROM {}".format(track_name), cur)
            if len(file_location) > 1:
                print('WARNING ({}): [db {}] Multiple files are associated with "{}" "({})" file.'
                      .format(ut.print_time(), organism, track_name, tr_type))
            file_location = file_location[0][0]
            
            if not re.match(r'^https?://', file_location):
                file_location = downloads_base_url + file_location
            if tr_type.startswith('bigBed '):
                sample_item = ut.get_first_item_from_bigbed(file_location)
                as_string = ut.fetch_autosql_for_bigbed(file_location)
                if as_string is not None:
                    bed_plus_fields = ut.extract_bed_plus_fields(tr_type, as_string=as_string)
            print('DONE ({}): [db {}] Fetched remote location for "{}" "{}" file.'.format(ut.print_time(),
                    organism, track_name, tr_type))

        # wig - these tracks are sometimes accessible as bigWig files, so if we can find that, we simply link to its URL
        elif tr_type.startswith('wig '):
            file_location = ut.find_bw_location_for_wig(organism, track_name)
            if file_location is None: continue
            print('DONE ({}): [db {}] Fetched remote location for "{}" "wig" file, as bigWig.'.format(ut.print_time(),
                    organism, track_name))

        # BED, genePred, rmsk, PSL, GVF, and narrowPeak processing - need to save and convert these to bigBed
        elif bedlike_format:
            if not args.update_metadata_only:
                bed_location = ut.fetch_bed_table(cur, track_name, organism, bedlike_format)
                if bed_location is None:
                    continue
                # An uncompressed copy of the cytoBandIdeo track is kept alongside tracks.db
                if track_name == 'cytoBandIdeo':
                    copyfile(bed_location, './{}/cytoBandIdeo.bed'.format(organism))
            
                as_location, bed_type = ut.get_as_and_bed_type_for_bedlike_format(bedlike_format)
                if as_location is None: # Generic BED tracks have autoSql specifying their fields on UCSC's MySQL server
                    as_location = ut.fetch_as_file(bed_location, cur, track_name)
                    bed_type = tr_type.replace(' ', '').rstrip('.')
            
                bed_plus_fields = ut.extract_bed_plus_fields(tr_type, as_location=as_location)
                file_location = ut.generate_big_bed(organism, bed_type, as_location, bed_location, bed_plus_fields)

                # If bigBed building failed, try fixing the autosql file once and retrying once. Also, don't index `id`.
                if file_location is None:
                    try:
                        ut.fix_bed_as_files(bed_location, bed_type)
                        file_location = ut.generate_big_bed(organism, bed_type, as_location, bed_location, None, True)
                    except:
                        pass
            
            if file_location is None:
                continue
            
            # Delete interim files for successful builds
            sample_item = ut.get_first_item_from_bigbed(file_location)
            if bed_location is not None: os.remove(bed_location)
            if as_location is not None and not as_location.startswith(os.path.join(script_directory, 'autosql')): 
                os.remove(as_location)
            
        else:
            print('INFO ({}): [db {}] Unhandled track type "{}" for table "{}".'.format(ut.print_time(), organism,
                                                                                        tr_type, track_name))
            continue

        # Everything went OK! If we've reached this point, it's safe to save track data to the local database.
        local_settings = ut.translate_settings(cur, organism, track_name, parent_track, 
                is_composite_or_super and not is_super_track, sample_item, remote_settings, bed_plus_fields, url)
        row_vals = (track_name, track_info[track_name]['displayName'], tr_type, group, track_info[track_name]['groupLabel'], 
                parent_track, track_info[track_name]['trackLabel'], short_label, long_label, track_priority[track_name], 
                file_location, html_description, update_date, settings, local_settings, is_composite_or_super, sort)
        ut.save_to_local_database(organism, localconn, row_vals, children)

    # ..ends the loop iterating over my_tracks.

    # ===================================================================================================
    # = Finally, check the composite and super tracks and if they are empty, mark them as low priority. =
    # ===================================================================================================
    
    if not args.dry_run:
        ut.deprioritize_empty_parent_tracks(organism, localconn)
    
