import lib.ucsc_tracks as ut
import lib.config as cfg
import pymysql.cursors
import os, glob
import argparse
import time
import sys
import re
import logging as log
import traceback
from shutil import copyfile

LOG_LEVELS = {-2: log.DEBUG, -1: log.INFO, 0: log.WARNING, 1: log.ERROR, 2: log.CRITICAL, 3: log.CRITICAL + 10}

# Set up arguments and handle argument parsing.
parser = argparse.ArgumentParser(description='Fetch tracks from UCSC table browser and construct BigBed files.')
parser.add_argument('-o', '--out', action='store', type=str, default='./data',
                    help='Directory where finished data will be stored (default is ./data).')
parser.add_argument('-n', '--dry_run', action='store_true', default=False,
                    help='Don\'t actually fetch any data, just list the tracks and what would be updated.')
parser.add_argument('-N', '--update_metadata_only', action='store_true', default=False,
                    help='Don\'t fetch any track data, just update each track\'s metadata in the local database.')
#FIXME: add a new argument to force ut.create_hierarchy() below to refetch the full track **hierarchy** (it sometimes changes)
parser.add_argument('-g', '--org_prefix', action='store', type=str, default='',
                    help='Restrict scraping to organism database names matching this prefix (or comma-separated prefixes).')
parser.add_argument('-G', '--skip_orgs', action='store', type=str, default='',
                    help='Skip organisms matching this prefix (or comma-separated prefixes). Takes precedence over --org_prefix')
parser.add_argument('-C', '--composite_tracks', action='store_true', default=False,
                    help='Also scrape composite tracks from UCSC (default is simple only).')
parser.add_argument('-S', '--super_tracks', action='store_true', default=False,
                    help='Also scrape supertracks from UCSC (default is simple only).')
parser.add_argument('-P', '--priority_below', action='store', type=float, default=None,
                    help='Restrict scraping to tracks with calculated priority below this number (1-1000).')
parser.add_argument('-t', '--track_prefix', action='store', type=str, default='',
                    help='Restrict scraping to tracks with names matching this prefix (or comma-separated prefixes).')
parser.add_argument('-T', '--skip_tracks', action='store', type=str, default='',
                    help='Skip tracks matching this prefix or (comma-separated prefixes). Takes precedence over --track_prefix')
parser.add_argument('-q', '--quiet', action='count', default=0,
                    help='Log less information to STDERR. Repeat the flag up to 3x to suppress more messages.')
parser.add_argument('-v', '--verbose', action='count', default=0,
                    help='Log more information to STDERR. Takes precedence over --quiet. Use twice to see DEBUG messages.')
parser.add_argument('--table_source', action='store', type=str, default='',
                    help='URL for the Table Browser webpage. Leave blank to retrieve it from the ../ucsc.yaml config file')
parser.add_argument('--mysql_host', action='store', type=str, default='',
                    help='Hostname for UCSC\'s MySQL server. Leave blank to retrieve it from the ../ucsc.yaml config file')
parser.add_argument('--downloads_base_url', action='store', type=str, default='',
                    help='Base URL for bulk downloads from UCSC. Leave blank to retrieve it from the ../ucsc.yaml config file')
args = parser.parse_args()

# Default log level is WARNING. Can use -q, -qq, and -qqq to print less, or -v and -vv to print more.
log_level = LOG_LEVELS.get(-min(args.verbose, 2) if args.verbose > 0 else min(args.quiet, 3), log.WARNING)
log.basicConfig(format='%(asctime)s %(levelname)s: %(message)s', level = log_level)

script_directory = os.path.dirname(os.path.abspath(__file__))
if not os.path.exists(args.out): os.makedirs(args.out)
os.chdir(args.out)

table_source = cfg.remote_table() if args.table_source == '' else args.table_source
tracks_source = cfg.remote_tracks()
mysql_host = cfg.mysql_host() if args.mysql_host == '' else args.mysql_host
downloads_base_url = cfg.downloads_base_url() if args.downloads_base_url == '' else args.downloads_base_url
downloads_base_url = downloads_base_url.rstrip('/')
organism_list = ut.get_organisms_list(host=mysql_host, prefix=args.org_prefix, skip=args.skip_orgs)

# ====================================================================
# = For every organism in the list of organisms we wish to scrape... =
# ====================================================================

for org_i, organism in enumerate(organism_list):
    log.info('#####################################')
    log.info('FETCHING DATA FOR ORGANISM: %s (%i/%i)', organism, org_i + 1, len(organism_list))
    log.info('EXTRACTING TRACK HIERARCHY')
    track_meta = ut.create_hierarchy(organism, table_source)
    if not track_meta:
        log.warning('No tables for organism %s found, skipping...', organism)
        continue

    # Try connecting to the UCSC MySQL database for this organism
    mysqlconn, cur = ut.connect_to_ucsc_mysql(host=mysql_host, db=organism)
    if cur is None: continue
    
    # Setup our local directories where track data will be saved
    ut.setup_directories(organism)
    
    # ==================================================================================================
    # = Generate a complete list of tracks to scrape based on UCSC's database and the script arguments =
    # ==================================================================================================

    selected_tracks, track_info = ut.distill_hierarchy(track_meta, args.composite_tracks)
    tracks_to_table_names = ut.tracks_to_table_names(selected_tracks, organism, cur)
    # Composite tracks do *not* have a corresponding table containing their data
    if args.composite_tracks is False: selected_tracks = tracks_to_table_names.keys()

    track_priority = ut.get_priority(db=organism, selection=selected_tracks, tracks_source=tracks_source, 
                                     track_info=track_info)
    
    selected_tracks = ut.filter_tracks_by_args(selected_tracks, args, track_priority)
    
    local_db, localconn = ut.create_sqllite3_db(organism)
    last_updates = ut.get_last_local_updates(localconn)
    remote_updates = ut.get_last_remote_updates(cur, organism, tracks_to_table_names)

    my_tracks = ut.fetch_tracks(xcur=cur, selection=selected_tracks)
    my_tracks = sorted(my_tracks, key=lambda row: (track_info[row[0]]['parentTrack'], row[0]))
    if len(my_tracks) == 0:
        log.warning("No tracks were selected by your criteria. Check your use of -C, -S, -P, -t, and -s...")
    
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
        log.debug('[db %s] Checking table "%s" (track %s) %s (%i)', 
                    organism, track_name, parent_track, tr_type, track_priority[track_name])
        
        file_location, bed_location, as_location, txt_gz_location = (None, None, None, None)
        bed_plus_fields = None
        get_sample_item = None
        table_name = tracks_to_table_names.get(track_name, None)
        remote_settings = ut.parse_trackdb_settings(settings)
        is_composite_or_super = table_name is None and 'bigDataUrl' not in remote_settings
        is_super_track = len(children) > 0
        update_date = None
        if len(tr_type.strip()) == 0: tr_type = 'bed'
        bedlike_format = ut.is_bedlike_format(tr_type)

        # First, check if we need to update the table at all
        update_date = remote_updates.get(track_name, None)
        if table_name is not None and track_name in last_updates:
            if not args.update_metadata_only and last_updates[track_name] == update_date:
                log.info('[db %s] Table "%s" is up to date', organism, track_name)
                continue
            else:
                noun = "metadata for " if args.update_metadata_only else ""
                log.debug('[db %s] Need to update %stable "%s"', organism, noun, track_name)
        else:
            track_noun = "supertrack" if is_super_track else ("composite track" if is_composite_or_super else "table")
            log.debug('[db %s] Need to fetch %s "%s"', organism, track_noun, track_name)
        if track_name in last_updates and not args.dry_run:
            file_location, bed_plus_fields = ut.get_last_location_and_bed_plus_fields(localconn, track_name)
        
        if args.dry_run: continue
        
        # Composite track/supertrack processing -- aren't backed by an actual MySQL table, but instead are groups of other tracks
        if is_composite_or_super:
            # No fetching/conversion to do--only need to translate the settings from UCSC's trackDb format --> chromozoom.
            pass

        # big* and BAM/vcfTabix processing - these files are already in big* format and accessible by URL, so little to do
        elif tr_type.split()[0] in ut.BIG_FORMATS:
            file_location = [[remote_settings.get('bigDataUrl')]]
            if file_location[0][0] is None:
                file_location = ut.qups("SELECT fileName FROM {}".format(track_name), cur)
            if len(file_location) > 1:
                log.warning('[db %s] Multiple files are associated with "%s" (%s).', organism, track_name, tr_type)
            file_location = file_location[0][0]
            
            if not re.match(r'^https?://', file_location):
                file_location = downloads_base_url + file_location
            if tr_type.split()[0] in ut.BIGBED_FORMATS:
                get_sample_item = ut.deferred_first_item_from_bigbed(file_location)
                as_string = ut.fetch_autosql_for_bigbed(file_location)
                if as_string is not None:
                    bed_plus_fields = ut.extract_bed_plus_fields(track_type=tr_type, as_string=as_string)
            log.info('[db %s] SUCCESS: Fetched remote location for "%s" (%s) file', organism, track_name, tr_type)

        # wig - these tracks are sometimes accessible as bigWig files, so if we can find that, we simply link to its URL
        # Otherwise, convert the .wib files in /gbdb/{organism}/wib to bigWig
        # TODO: Also convert bedGraph to bigWig
        elif tr_type.split()[0] == 'wig':
            file_location = ut.find_bw_location_for_wig(organism, track_name)
            if file_location is not None:
                log.info('[db %s] SUCCESS: Fetched remote location for "%s" (wig) file, as bigWig.', organism, track_name)
            elif not args.update_metadata_only:
                # We have to download the .wib files and convert them to bigWig using hgWiggle and bigWigToWig
                wib_files = ut.fetch_wib_files(cur, organism, track_name, table_name)
                if wib_files is not None:
                    file_location = ut.generate_bigwig(organism, track_name, table_name)
                
                if file_location and not os.path.isfile(file_location):
                    ut.delete_from_local_database(organism, localconn, track_name)
                    file_location = None
                if file_location is None: continue  # Don't ever save track metadata if the bigWig file hasn't been built
                if wib_files is not None: [os.remove(f) for f in wib_files] # Delete interim files for successful builds

        # BED, genePred, rmsk, PSL, GVF, pgSnp, broadPeak, narrowPeak, chain processing: save and convert these to bigBed
        # TODO: more formats to implement: netAlign, bedDetail
        elif bedlike_format:
            if args.update_metadata_only: 
                file_location = './{}/bigBed/{}.bb'.format(organism, track_name)
                if os.path.isfile(file_location):
                    get_sample_item = ut.deferred_first_item_from_bigbed(file_location)
                    bed_plus_fields = ut.extract_bed_plus_fields(bigbed_location=file_location)
            else:
                bed_location, txt_gz_location = ut.fetch_bed_table(cur, organism, track_name, table_name, tr_type.split())
                if bed_location is None:
                    continue
                # An uncompressed copy of the cytoBandIdeo track is kept alongside tracks.db
                if track_name == 'cytoBandIdeo':
                    copyfile(bed_location, './{}/cytoBandIdeo.bed'.format(organism))
            
                as_location, bed_type = ut.get_as_and_bed_type_for_bedlike_format(bedlike_format, bed_location)
                if as_location is None: # Generic BED tracks have autoSql specifying their fields on UCSC's MySQL server
                    as_location = ut.fetch_asql_file(cur, organism, bed_location, table_name)
                    bed_type = tr_type.replace(' ', '').rstrip('.')
                if os.path.isfile(bed_location + '.wasfixed'):
                    with open(bed_location + '.wasfixed', 'r') as f: bed_type = f.read().strip()

                bed_plus_fields = ut.extract_bed_plus_fields(track_type=bed_type, as_location=as_location)
                file_location = ut.generate_bigbed(organism, bed_type, as_location, bed_location, bed_plus_fields)
                
                # Chain tracks require a bigLink file to be built
                if bedlike_format == 'chain':
                    file_location = file_location if ut.generate_biglink(organism, bed_location) else None
                
                # If bigBed building failed, try fixing the autosql and BED files, if they haven't been fixed before.
                if file_location is None and not os.path.isfile(bed_location + '.wasfixed'):
                    try:
                        bed_type = ut.fix_bed_and_as_files(organism, bed_location, bed_type, as_location)
                        file_location = ut.generate_bigbed(organism, bed_type, as_location, bed_location, None, True)
                        if file_location is not None:
                            bed_plus_fields = ut.extract_bed_plus_fields(bigbed_location=file_location)
                            if bedlike_format == 'chain':
                                ut.fix_bed_and_as_files(organism, bed_location + '.link.bed', 'bed4+1', None)
                                file_location = file_location if ut.generate_biglink(organism, bed_location) else None
                    except:
                        exc = ''.join(traceback.format_exception(*sys.exc_info()))
                        log.warning('[db %s] FAILED: error while fixing AS/BED files for %s\n%s', organism, track_name, exc)
            
            if file_location and not os.path.isfile(file_location):
                ut.delete_from_local_database(organism, localconn, track_name)
                file_location = None
            if file_location is None: continue  # Don't ever save track metadata if the bigBed file hasn't been built
            
            get_sample_item = ut.deferred_first_item_from_bigbed(file_location)
            
            # Delete interim files for successful builds
            if bed_location is not None: [os.remove(f) for f in glob.glob(bed_location + '*')]
            if txt_gz_location is not None: [os.remove(f) for f in glob.glob(txt_gz_location + '*')]
            if as_location is not None: os.remove(as_location) 
            
        else:
            log.warning('[db %s] FAILED: Unhandled track type "%s" for table "%s"', organism, tr_type, track_name)
            continue

        # Everything went OK! If we've reached this point, it's safe to save track metadata to the local database.
        local_settings = ut.translate_settings(cur, organism, track_name, parent_track, 
                is_composite_or_super and not is_super_track, get_sample_item, remote_settings, bed_plus_fields, url)
        row_vals = (track_name, track_info[track_name]['displayName'], tr_type, group, track_info[track_name]['groupLabel'], 
                parent_track, track_info[track_name]['trackLabel'], short_label, long_label, track_priority[track_name], 
                file_location, html_description, update_date, settings, local_settings, is_composite_or_super, sort)
        ut.save_to_local_database(organism, localconn, row_vals, children)

    # ... ends the loop iterating over my_tracks.

    # ===================================================================================================
    # = Finally, check the composite and super tracks and if they are empty, mark them as low priority. =
    # ===================================================================================================
    
    if not args.dry_run:
        ut.deprioritize_empty_parent_tracks(organism, localconn)
    
    # Close the connections to the UCSC MySQL database for this organism and the local database that we've updated
    mysqlconn.close()
    localconn.close()
