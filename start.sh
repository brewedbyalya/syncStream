#!/bin/bash

# Wait for database to be ready
echo "Waiting for database..."
sleep 3

# Run migrations
python manage.py migrate

# Collect static files
python manage.py collectstatic --noinput

# Start server
if [ "$RAILWAY_ENVIRONMENT" = "production" ]; then
    echo "Starting production server..."
    gunicorn syncstream_project.wsgi:application --bind 0.0.0.0:$PORT --workers 3 --timeout 120
else
    echo "Starting development server..."
    python manage.py runserver 0.0.0.0:$PORT
fi