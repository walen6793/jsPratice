class AppError extends Error {
    constructor(message, statusCode){
        super(message);
        this.name = "ValidationError";
        this.statusCode = statusCode || 400;
        this.isOperational = true;
    }
}
module.exports = AppError;