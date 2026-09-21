import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "../constants/routes.constants";
import { isValidObjectId } from "../Utlis/Common/objectId";

export default function useObjectIdParam(paramName = "id", { redirectTo = ROUTES.NOT_FOUND, enabled = true } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const id = params[paramName] || "";
  const isValid = !enabled || isValidObjectId(id);

  useEffect(() => {
    if (enabled && !isValid) navigate(redirectTo, { replace: true });
  }, [enabled, isValid, navigate, redirectTo]);

  return { id: enabled && isValid ? id : null, isValid };
}
