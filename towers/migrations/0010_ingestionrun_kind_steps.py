from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('towers', '0009_watchtowersite_state'),
    ]

    operations = [
        migrations.AddField(
            model_name='ingestionrun',
            name='kind',
            field=models.CharField(
                choices=[('ingest_cycle', 'Ingest cycle'), ('viewsheds', 'Viewsheds')],
                default='ingest_cycle',
                help_text='Which pipeline this run tracks.',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='ingestionrun',
            name='steps',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='Per-step statuses for ingest_cycle runs.',
            ),
        ),
    ]
