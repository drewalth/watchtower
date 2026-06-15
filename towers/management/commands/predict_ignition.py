"""Score today's ignition probability per tower from the trained artifact.

Loads the model train_fire_model wrote, builds each tower's most recent feature
row, and upserts one IgnitionPrediction. A graceful no-op (warn, exit 0) when no
artifact exists yet, so the hourly scheduler never crashes before a model has
been trained.
"""
from django.core.management.base import BaseCommand, CommandError

from towers.ml.django_data import latest_feature_row
from towers.ml.model import IgnitionModel
from towers.models import IgnitionPrediction, WatchtowerSite

from .train_fire_model import ARTIFACT_PATH


class Command(BaseCommand):
    help = (
        "Write today's IgnitionPrediction per tower using the trained model "
        "artifact. No-op (with a warning) if no model has been trained yet."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--tower", type=int, default=None,
            help="Only predict for this tower id (default: all towers).",
        )

    def handle(self, *args, **options):
        if not ARTIFACT_PATH.exists():
            self.stdout.write(self.style.WARNING(
                f"No model artifact at {ARTIFACT_PATH} — run 'train_fire_model' "
                "first. Nothing to predict."
            ))
            return

        towers = WatchtowerSite.objects.all()
        if options["tower"] is not None:
            towers = towers.filter(pk=options["tower"])
        towers = list(towers)
        if not towers:
            raise CommandError(
                "No matching towers — run 'python manage.py seed_towers' first."
            )

        model = IgnitionModel.load(ARTIFACT_PATH)
        created = updated = skipped = 0
        for tower in towers:
            row = latest_feature_row(tower)
            if row is None:
                # No fully-populated day yet (needs weather + a risk assessment).
                self.stderr.write(self.style.WARNING(
                    f"  {tower.name}: skipped — no weather+risk day to score."
                ))
                skipped += 1
                continue
            as_of, features = row
            probability = model.predict_one(features)
            _, was_created = IgnitionPrediction.objects.update_or_create(
                tower=tower, date=as_of, model_version=model.model_version,
                defaults={
                    "probability": probability,
                    "horizon_days": model.horizon_days,
                },
            )
            created += was_created
            updated += not was_created
            self.stdout.write(
                f"  {tower.name}: P(ignition)={probability:.3f} "
                f"@ {as_of} ({model.horizon_days}d)"
            )

        self.stdout.write(self.style.SUCCESS(
            f"Predictions written ({model.model_version}) — created {created}, "
            f"updated {updated}, skipped {skipped}."
        ))
