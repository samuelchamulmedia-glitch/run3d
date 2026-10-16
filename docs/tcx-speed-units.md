# COROS TCX pace unit validation

Some COROS-generated TCX files put Speed directly in the core TCX namespace without declared units. The importer previously treated every Speed field as meters per second. A km/h field would then produce a pace 3.6 times too fast.

The importer now validates nonstandard core Speed fields ONLY for a COROS Creator. It compares time-integrated speed against recorded DistanceMeters in independent windows of at least 20 seconds, excluding clock gaps, backwards distance, segment boundaries and inadequate measurements. It requires at least three windows, a median near the proposed unit scale, and at least 70% agreement. Values matching m/s stay unchanged. Values matching km/h are divided by 3.6. Standard Garmin extension fields and non-COROS producers are never converted by this correction.

Ambiguous core speed values are withheld instead of guessing a unit; pace may fall back to GPS/time where reliable. Original XML fields remain unchanged in Sample.raw. Import warnings disclose corrections or unverified units. The source file is never modified.

Validation uses synthetic regression fixtures for km/h versus m/s, producer/namespace isolation, inadequate evidence, inconsistent scales, irregular sampling and clock/distance problems. A supplied private activity was also checked locally through the production model and calibration helper; the reported anomalous pace was reproduced and corrected. No private activity file, coordinates, source rows or health measurements are included in this package or permanent tests.
