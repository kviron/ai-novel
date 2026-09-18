class MigrationError(RuntimeError):
    """Raised when the database cannot be upgraded to the required schema."""
