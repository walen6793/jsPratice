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

    // 🔴 DEBUG LOG: เปิดดูความจริงใน Vercel Logs
    console.log("========================================");
    console.log("1. Server Secret (ความยาว):", mySecretKey ? mySecretKey.length : 'undefined');
    console.log("2. Server Secret (ค่าจริง):", JSON.stringify(mySecretKey)); // ใส่ JSON.stringify เพื่อดูช่องว่างที่ซ่อนอยู่
    console.log("----------------------------------------");
    console.log("3. Client Sent (ความยาว):", api_key ? api_key.length : 'undefined');
    console.log("4. Client Sent (ค่าจริง):", JSON.stringify(api_key));
    console.log("========================================");

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