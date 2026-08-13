"""Compute terrain viewsheds for lookout towers from the Copernicus GLO-30 DEM.

Delegates to ``towers.viewshed.compute_viewshed`` for each tower, which fetches
DEM tiles over HTTP from AWS, mosaics and reprojects them to UTM with GDAL, runs
``gdal_viewshed``, then polygonizes the result back to SRID 4326 for storage.
The stored ``WatchtowerSite.viewshed`` polygon supersedes the naive radius circle
for coverage queries and fire counting once it is present.

This command requires the GDAL CLI tools (``gdalbuildvrt``, ``gdalwarp``,
``gdal_viewshed``) — run it inside the Docker container. Each tower takes roughly
one minute.

``--only-missing`` is the safe re-run flag after adding new towers: it skips
towers that already have a viewshed so existing computation is not wasted.
``--track`` records the run in ``IngestionRun`` so the frontend status pill can
show viewshed progress.
"""
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from towers.models import IngestionRun, WatchtowerSite
from towers.viewshed import compute_viewshed


class Command(BaseCommand):
    help = (
        "Compute terrain viewsheds (line-of-sight polygons) for towers from the "
        "Copernicus GLO-30 DEM and store them. Supersedes the naive radius circle."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--tower", type=int, default=None,
            help="Only compute for this tower id (default: all towers).",
        )
        parser.add_argument(
            "--mast", type=float, default=10.0,
            help="Observer mast height in metres above the ground. Default 10.",
        )
        parser.add_argument(
            "--only-missing", action="store_true",
            help="Only compute towers that don't already have a stored viewshed.",
        )
        parser.add_argument(
            "--track", action="store_true",
            help=(
                "Record this run in an IngestionRun row (kind=viewsheds) so the "
                "status endpoint can surface viewshed progress to the frontend."
            ),
        )

    def handle(self, *args, **options):
        track = options["track"]
        run = None
        if track:
            run = IngestionRun.objects.create(
                kind=IngestionRun.Kind.VIEWSHEDS,
                status=IngestionRun.Status.RUNNING,
            )

        try:
            self._run(options)
        except Exception:
            if run is not None:
                run.status = IngestionRun.Status.FAILED
                run.finished_at = timezone.now()
                run.save(update_fields=["status", "finished_at"])
            raise

        if run is not None:
            run.status = IngestionRun.Status.COMPLETED
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "finished_at"])

    def _run(self, options):
        towers = WatchtowerSite.objects.all()
        if options["tower"] is not None:
            towers = towers.filter(pk=options["tower"])
        if options["only_missing"]:
            towers = towers.filter(viewshed__isnull=True)
        towers = list(towers)
        if not towers:
            if options["only_missing"]:
                # All towers already have viewsheds (or none seeded yet) — clean no-op.
                self.stdout.write("No towers need a viewshed — nothing to do.")
                return
            raise CommandError("No matching towers — seed_towers first.")

        for tower in towers:
            self.stdout.write(f"Computing viewshed for {tower.name}…")
            try:
                viewshed = compute_viewshed(tower, mast_height_m=options["mast"])
            except RuntimeError as exc:
                # e.g. a DEM tile is missing (ocean) or GDAL failed — keep going.
                self.stderr.write(self.style.WARNING(f"  skipped: {exc}"))
                continue

            tower.viewshed = viewshed
            tower.save(update_fields=["viewshed"])
            if viewshed is None:
                self.stdout.write("  no visible area returned.")
            else:
                # area_sq_km via an equal-area-ish check isn't needed; report counts.
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  stored viewshed — {tower.fires_in_range().count()} "
                        f"fire(s) now visible."
                    )
                )
