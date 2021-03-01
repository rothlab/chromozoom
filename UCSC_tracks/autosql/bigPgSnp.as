table bigPgSnp
"bigPgSnp format for displaying SNPs, used for the Genome Variants and Population Variants tracks"
    (
    string chrom;       "Reference sequence chromosome or scaffold"
    uint   chromStart;  "Start position in chromosome"
    uint   chromEnd;    "End position in chromosome"
    string name;        "Alleles represented by strings of [ACTG-] separated by /"
    uint alleleCount;   "The number of alleles listed in the name field"
    string alleleFreq;  "A comma-separated list of the frequency of each allele, in the same order as the name field"
    string alleleScores;"A comma-separated list of the quality score of each allele, in the same order as the name field."
    )
