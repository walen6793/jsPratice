// const mySecretKey = process.env.MY_SECRET_KEY

// function checkAPI_key(req,res,next){
//     const api_key = req.headers['X-API-KEY'] || req.headers['x_api_key']
//     if (api_key && api_key === mySecretKey){
//         next()
//     }else {
//         console.error("Invalid API Key:", api_key);
//         res.status(403).json({message: 'Forbidden. Invalid API Key'})
//         return
//     }
// }
// module.exports = checkAPI_key

const mySecretKey = process.env.MY_SECRET_KEY; // (เช็คชื่อตัวแปรใน Vercel ให้ดีนะครับว่าชื่อนี้เป๊ะๆ)

function checkAPI_key(req, res, next) {
    const api_key = req.headers['x-api-key'];


    if (api_key && api_key === mySecretKey) {
        next();
    } else {
        res.status(403).json({ 
            message: 'Forbidden. Invalid API Key',
            debug_info: { // ส่งกลับไปให้ Postman ดูเลย (ลบออกทีหลังนะ)
                server_has_key: !!mySecretKey,
                client_sent_key: api_key,
                match: api_key === mySecretKey
            }
        });
    }
}

module.exports = checkAPI_key;