import { Router } from "express";
import userAuthMiddleware from "../../middleware/user-auth.js";
import { ApiKeys } from "../../data/models/api-keys.js";

const router = Router();
router.use(userAuthMiddleware);

router.get("/", async (req, res) => {
    const userId = res.locals.userId;
    const apiKeys = await ApiKeys.getByUserId(userId); 
    return res.json({
        success: true,
        data: { apiKeys }
    });
});

router.post("/generate", async (req, res) => {
    const userId = res.locals.userId;
    const newApiKey = crypto.randomUUID();
    await ApiKeys.create({ userId, apiKey: newApiKey });
    return res.json({
        success: true,
        data: { apiKey: newApiKey }
    });

});

export default router;