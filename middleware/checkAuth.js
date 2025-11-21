const jwt = require('jsonwebtoken');
const ValidationError = require('../validateErr/AppError');
const dotenv = require('dotenv').config();


function checkAuth(req,res,next){
    const authHeader = req.headers.authorization;
    console.log("auth,",authHeader )
    try{
    if (!authHeader){
        throw new ValidationError("ไม่มีการส่ง Token มาใน Header",401)
}

    const token = authHeader.split(' ')[1];
    if (!token){
        throw new ValidationError("ไม่มีการส่ง Token มาใน Header",401)
    }
    const secret_key = process.env.JWT_SECRET;
    jwt.verify(token, secret_key,(err,decoded) => {
        if (err){
            console.error("JWT Verification Error:", err);
            throw new ValidationError("Token ไม่ถูกต้องหรือหมดอายุ",401)
        }
        console.log("Decoded JWT:", decoded);
        req.user = decoded;
        next();
    })
}catch(error){
    res.status(error.statusCode || 500).json({message: error.message || 'Internal Server Error'});
}
}

module.exports = checkAuth;