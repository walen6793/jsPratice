const mySecretKey = process.env.MY_SECRET_KEY

function checkAPI_key(req,res,next){
    const api_key = req.headers['X-API-KEY'] || req.headers['x_api_key']
    if (api_key && api_key === mySecretKey){
        next()
    }else {
        console.error("Invalid API Key:", api_key);
        res.status(403).json({message: 'Forbidden. Invalid API Key'})
        return
    }
}
module.exports = checkAPI_key

