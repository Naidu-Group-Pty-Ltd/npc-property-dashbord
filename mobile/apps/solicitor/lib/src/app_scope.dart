import 'package:npc_api/npc_api.dart';

/// Every portal app is portal-scoped, and cannot reach a staff function.
///
/// This is the same contract `check-api-scope.mjs` enforces over the sources
/// (mobile/plan.md R-ARCH-4); declaring it here means the app cannot construct
/// a client with the wrong authority even by accident.
const NpcFunctionScope appScope = NpcFunctionScope.portal;
