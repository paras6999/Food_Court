import os
import uuid
from flask import current_app
from werkzeug.utils import secure_filename
from PIL import Image

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_image(file, subfolder: str = "") -> str | None:
    """Save an uploaded file and return its relative URL. Returns None on failure."""
    if not file or not allowed_file(file.filename):
        return None

    upload_dir = os.path.join(current_app.root_path, current_app.config["UPLOAD_FOLDER"], subfolder)
    os.makedirs(upload_dir, exist_ok=True)

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(upload_dir, filename)

    # Resize large images to max 800px wide to save space
    img = Image.open(file)
    if img.width > 800:
        ratio = 800 / img.width
        img = img.resize((800, int(img.height * ratio)), Image.LANCZOS)
    img.save(filepath, quality=85, optimize=True)

    relative = f"/{current_app.config['UPLOAD_FOLDER']}/{subfolder}/{filename}".replace("\\", "/").replace("//", "/")
    return relative
