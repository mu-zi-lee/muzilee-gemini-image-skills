export async function applyTaskSetup(task, { clickNewChat, switchModel, uploadReferenceImages, selectors, catalog, logger }) {
  const payload = task.payload || {};
  const setup = payload.setup || {};
  const result = {};

  if (setup.new_chat) {
    await clickNewChat(selectors);
    result.new_chat = true;
  }

  if (setup.model) {
    result.model = await switchModel(selectors, setup.model, catalog);
  }

  if (setup.reference_images && setup.reference_images.length) {
    result.upload = await uploadReferenceImages(selectors, setup.reference_images, logger);
  }

  return result;
}

