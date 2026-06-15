from django.core.management.base import BaseCommand, CommandError

from towers.models import WatchtowerSite
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

    def handle(self, *args, **options):
        towers = WatchtowerSite.objects.all()
        if options["tower"] is not None:
            towers = towers.filter(pk=options["tower"])
        if options["only_missing"]:
            towers = towers.filter(viewshed__isnull=True)
        towers = list(towers)
        if not towers:
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
