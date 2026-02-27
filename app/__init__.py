"""Flask application factory for StatementOfWork."""
import os
from flask import Flask


def create_app(config=None):
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates'),
        static_folder=os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static')
    )

    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')
    app.config['DATABASE_URL'] = os.environ.get('DATABASE_URL', 'sqlite:///sow.db')
    app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max upload

    if config:
        app.config.update(config)

    from app.routes import main_bp, api_bp, plugin_bp
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp, url_prefix='/api')
    app.register_blueprint(plugin_bp, url_prefix='/plugin')

    from app.models import init_db
    with app.app_context():
        init_db(app)

    return app
